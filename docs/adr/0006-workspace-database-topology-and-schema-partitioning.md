# ADR 0006: Topologia e Particionamento Físico de Bancos SQLite (E21)

## Status
Aceito

## Contexto
O ADR 0005 definiu a estratégia de migrar de um banco monolítico central para uma arquitetura híbrida particionada por workspace. 
Durante a implementação e auditoria técnica do E21 (Issue #279 / #280), levantou-se a necessidade de formalizar a topologia exata de dados, divisão de schemas, resolução de localização e integridade referencial entre entidades globais e dados de workspace.

## Decisões de Arquitetura

### 1. Resolução do Hash do Workspace
- O `workspaceHash` é derivado de forma determinística e canônica a partir do diretório do projeto (`Location.Ref.directory`), utilizando a normalização de slug/hash já adotada no sistema (`projectKey`).
- Workspaces em diretórios distintos recebem bases físicas de dados totalmente isoladas em `~/.local/share/opencode/workspaces/<hash>/project.db`.

### 2. Separação Estrita de Schemas Drizzle
- **Banco Global (`global.db`):** Gerencia entidades de nível de processo, usuário e autenticação:
  - `account`, `account_state`, `control_account`
  - `credential`
  - `project`, `project_directory`
  - `workspace`
  - `schedule`
  - `session_location` (Índice global de localização)
- **Banco de Workspace (`project.db`):** Gerencia entidades de sessão, execução e histórico local:
  - `session`
  - `message`, `part`
  - `session_message`, `session_input`, `session_context_epoch`
  - `todo`
  - `permission`
  - `event`, `event_sequence` (Event Log Durável particionado)
- **Desacoplamento de Foreign Key:** A chave estrangeira `session.project_id -> project.id` deixa de ser uma restrição em nível de banco SQLite (cross-database FK não suportada) e passa a ser garantida em nível de aplicação/código no `ProjectV2.ID`.

### 3. Índice Global `session_location`
- O `global.db` mantém a tabela leve `session_location` (`session_id TEXT PRIMARY KEY`, `directory TEXT NOT NULL`, `workspace_id TEXT`):
  - Preenchida e atualizada no momento de criação ou migração de qualquer sessão.
  - Permite que o middleware `SessionLocationMiddleware` descubra em $O(1)$ o diretório exato e workspace de qualquer `session_id` sem necessidade de abrir ou varrer múltiplos bancos no sistema de arquivos.

### 4. Particionamento do Event Log Durável
- As tabelas `event` e `event_sequence` residem diretamente em cada `project.db`.
- Como os eventos duráveis são delimitados pelo aggregate `sessionID`, o crescimento de sessões em um workspace nunca satura a tabela de eventos de outro workspace.

## Consequências

### Positivas
- **Isolamento Total:** Um projeto com histórico extenso de sessões ou eventos não gera contenção de lock nem degrada a performance de outros projetos no mesmo host.
- **Housekeeping Simples:** Apagar ou arquivar um workspace é tão simples quanto remover sua pasta física `workspaces/<hash>/`.
- **Descoberta Instantânea ($O(1)$):** O índice `session_location` evita qualquer chicken-and-egg na resolução de rotas HTTP por `sessionID`.

### Mitigações
- **Zero Data Loss:** O comando de migração assistida e inicialização de workspace (`WorkspaceMigration.migrateWorkspaceHistory`) preenche o índice `session_location` no `global.db` ao migrar sessões existentes do monolito.
