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

### 3. Atomicidade Transacional do Índice Global via SQLite ATTACH
- Como a gravação da projeção da sessão reside no `project.db` e o índice reside no `global.db`, gravações desconectadas criariam risco de sessão órfã (404 no `SessionLocationMiddleware` em caso de crash entre os writes).
- **Mecanismo de Atomicidade:** A conexão do `project.db` executa `ATTACH DATABASE '<globalDbPath>' AS global_db;`.
- A inserção/atualização da sessão no `project.db` e a inserção/atualização do índice em `global_db.session_location` são encapsuladas rigorosamente dentro da **mesma transação SQLite**, garantindo atomicidade ACID cross-database nativa.

### 4. Particionamento do Event Log Durável e Extensão do Migrate
- As tabelas `event` e `event_sequence` residem diretamente em cada `project.db`.
- O utilitário `WorkspaceMigration.migrateWorkspaceHistory` é formalmente estendido para migrar:
  1. `session`, `message`, `part`;
  2. `event`, `event_sequence` (preservando rigorosamente a contiguidade do `seq`);
  3. Preenchimento transacional do índice `session_location` no `global.db`.

## Consequências

### Positivas
- **Isolamento Total:** Um projeto com histórico extenso de sessões ou eventos não gera contenção de lock nem degrada a performance de outros projetos no mesmo host.
- **Housekeeping Simples:** Apagar ou arquivar um workspace é tão simples quanto remover sua pasta física `workspaces/<hash>/`.
- **Descoberta Instantânea ($O(1)$):** O índice `session_location` evita qualquer chicken-and-egg na resolução de rotas HTTP por `sessionID`.

### Mitigações
- **Zero Data Loss:** O comando de migração assistida e inicialização de workspace (`WorkspaceMigration.migrateWorkspaceHistory`) preenche o índice `session_location` no `global.db` ao migrar sessões existentes do monolito.
