# ADR 0006: Topologia e Particionamento Físico de Bancos SQLite (E21)

## Status
Aceito

## Contexto
O ADR 0005 definiu a estratégia de migrar de um banco monolítico central para uma arquitetura híbrida particionada por workspace. 
Durante a implementação e auditoria técnica do E21 (Issue #279 / #280), levantou-se a necessidade de formalizar a topologia exata de dados, divisão de schemas, resolução de localização e integridade referencial entre entidades globais e dados de workspace.

## Decisões de Arquitetura

### 1. Resolução do Hash do Workspace e Migração de Namespace
- O `workspaceHash` **NÃO utiliza mais `projectKey`** (que continha colisões graves com `/a/b` vs `/a_b` e truncamento `slice(-80)` em monorepos/worktrees).
- O hash é derivado de forma criptograficamente determinística e imune a colisões:
  ```ts
  sha256(path.resolve(directory).toLowerCase()).slice(0, 16)
  ```
- Workspaces em diretórios distintos recebem bases físicas de dados totalmente isoladas em `~/.local/share/opencode/workspaces/<hash>/project.db`.
- **Migração da Namespace de Memória:** O helper de memória (`workspaceMemoryDir`) adota o mesmo hash SHA256(16). É fornecido fallback transparente: se existir pasta com o hash legado do `projectKey`, o conteúdo é renomeado/migrado transparentemente para o novo hash SHA256 no primeiro acesso.

### 2. Separação Estrita de Schemas Drizzle
- **Banco Global (`global.db`):** Gerencia entidades de nível de processo, usuário e autenticação:
  - `account`, `account_state`, `control_account`
  - `credential`
  - `project`, `project_directory`
  - `workspace`
  - `schedule`
  - `session_location` (Índice global de localização com índices em `session_id`, `directory` e `workspace_id`, com colunas `time_created` e `time_updated`)
- **Banco de Workspace (`project.db`):** Gerencia entidades de sessão, execução e histórico local:
  - `session`
  - `message`, `part`
  - `session_message`, `session_input`, `session_context_epoch`
  - `todo`
  - `permission`
  - `event`, `event_sequence` (Event Log Durável particionado)
- **Desacoplamento de Foreign Key:** A chave estrangeira `session.project_id -> project.id` deixa de ser uma restrição em nível de banco SQLite (cross-database FK não suportada) e passa a ser garantida em nível de aplicação/código no `ProjectV2.ID`.
- **Fanout de Exclusão:** Como a FK física foi removida, a exclusão de um `project` no `global.db` executa um fanout seguro via aplicação, consultando `session_location` e excluindo/desvinculando as sessões correspondentes no respectivo `project.db`.

### 3. Consistência do Índice Global: project-first + Reconciler Idempotente
- A projeção da sessão é gravada no `project.db` (via `Database.Service`, a conexão da location) e o índice `session_location` no `global.db` (via `Database.GlobalService`). São **duas conexões e duas transações distintas**: não existe atomicidade cross-database.
- **Por que NÃO usar `ATTACH`:** abrir o `global.db` com `ATTACH DATABASE` dentro da conexão do `project.db` para escrever ambos numa "mesma transação" **não garante atomicidade cross-database** quando o `project.db` opera em WAL — o write-ahead log de um arquivo não cobre o outro, de modo que um crash ainda pode deixar um dos lados aplicado e o outro não. Abandonar o WAL num dos arquivos para viabilizar o `ATTACH` colidiria com o objetivo de concorrência/`PRAGMAs` do #281. O mecanismo foi descartado.
- **Ordem de escrita (project-first):** a sessão é gravada no `project.db` **antes** do índice no `global.db`. Um crash entre os writes produz uma sessão existente **sem** entrada no índice (órfã invisível — `404` no `SessionLocationMiddleware`), nunca o inverso (índice apontando para sessão inexistente).
- **Reparo (reconciler idempotente):** o event log durável (`event`/`event_sequence`, no `project.db`) é a fonte de verdade (#282). Um reconciler deriva o índice a partir dele e executa **upsert idempotente** de `session_location`. Em particular, no caminho de redelivery, "sessão já projetada mas índice ausente" deve **reescrever o índice** em vez de apenas retornar a sessão existente (hoje `SessionAlreadyProjected` é engolido e o órfão permanece invisível permanentemente). O índice é, portanto, **eventualmente consistente** com a projeção.

### 4. Particionamento do Event Log Durável e Extensão do Migrate
- As tabelas `event` e `event_sequence` residem diretamente em cada `project.db`.
- **Invariantes do Event Log Particionado (B3 / #284):**
  1. **Durável ⇒ Tem Workspace:** Qualquer evento durável (`definition.durable` definido) pertence a um agregado associado a um workspace e deve ser gravado exclusivamente no `project.db` daquele workspace. Eventos globais (sem workspace) são estritamente transientes/live-only.
  2. **`seq` como Watermark Monotônico (Zero Rebase):** O sequence (`seq`) de um evento durável atua como watermark de sincronização para clientes locais e remotos (`durable({ aggregateID, after })`). Por isso, em operações de backfill ou migração entre bancos (move), as linhas são copiadas **verbatim** com o `seq` original. O `seq` é garantidamente monotônico por aggregate (semeado por `MAX(seq)` existente), mas **não necessariamente contíguo ou 1-based** (inicia em 0 por aggregate).
- O utilitário `WorkspaceMigration.migrateWorkspaceHistory` e `EventLogBackfill.backfillEventLog` foram consolidados para migrar:
  1. `session`, `message`, `part`;
  2. `event`, `event_sequence` (copiados verbatim, preservando a monotonicidade do `seq`);
  3. Preenchimento idempotente do índice `session_location` no `global.db` (a partir das sessões migradas; ver §3).

## Consequências

### Positivas
- **Isolamento Total:** Um projeto com histórico extenso de sessões ou eventos não gera contenção de lock nem degrada a performance de outros projetos no mesmo host.
- **Housekeeping Simples:** Apagar ou arquivar um workspace é tão simples quanto remover sua pasta física `workspaces/<hash>/`.
- **Descoberta Instantânea ($O(1)$):** O índice `session_location` evita qualquer chicken-and-egg na resolução de rotas HTTP por `sessionID`.

### Mitigações
- **Zero Data Loss:** O comando de migração assistida e inicialização de workspace (`WorkspaceMigration.migrateWorkspaceHistory`) preenche o índice `session_location` no `global.db` ao migrar sessões existentes do monolito.
- **Reparo de órfãos (índice eventualmente consistente):** o reconciler idempotente do §3 reconstrói `session_location` a partir do event log durável (`event`/`event_sequence` no `project.db`), recuperando sessões projetadas sem entrada no índice — inclusive no caso de redelivery hoje engolido por `SessionAlreadyProjected`.
