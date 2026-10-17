# ADR 0005: Arquitetura de Persistência Híbrida e Particionada por Workspace (JSONL + SQLite)

## Status
Aceito

## Contexto
O OpenCode armazena todo o seu estado em um banco de dados monolítico central SQLite (`~/.local/share/opencode/opencode.db` ou variantes por canal de instalação).

Com o uso continuado do sistema em múltiplos workspaces e sessões de codificação com LLMs, observou-se uma degradação severa de performance e latência perceptível ao clicar em ações e trocar de telas. Uma investigação detalhada revelou os seguintes fatores:
1. **Inchaço de Blobs de Eventos na Tabela `event`:** Eventos do tipo `message.updated.1` e deltas de streaming de mensagens armazenam snapshots cumulativos de texto em formato JSON dentro do SQLite. Em bancos reais analisados, poucas milhares de linhas de eventos acumulam mais de 860 MB a 3 GB de dados em uma única tabela.
2. **Contenção de Lock e Overflow Pages no SQLite:** Devido ao tamanho dos payloads JSON que excedem o tamanho padrão de página (4KB), o motor do SQLite gera milhares de páginas de transbordo (overflow pages). Além disso, transações contínuas de escrita durante o streaming de LLM geram contenção nos locks do banco (mesmo em modo WAL), atrasando consultas síncronas simples disparadas pela interface visual.
3. **Falta de Isolamento entre Projetos:** O crescimento de volume de um projeto antigo ou sessão pesada degrada o tempo de resposta de todos os outros workspaces abertos no mesmo host. Em contraste, ferramentas como o Claude Code utilizam append-only de arquivos `.jsonl` particionados por sessão e projeto, mantendo tempo de resposta constante (~5ms).

## Decisão

Adotar uma **arquitetura híbrida e particionada de armazenamento**, dividida em três pilares:

### 1. Separação de Responsabilidades: Relacional vs. Streaming Event Log
- **Projeções Relacionais (SQLite):** Tabelas que exigem buscas, ordenação, relacionamentos e foreign keys (`session`, `message`, `part`, `todo`, `permission`, `schedule`) permanecem gerenciadas no SQLite via Drizzle ORM.
- **Log de Eventos Transitórios / Transcrições (JSONL no Sistema de Arquivos):** Eventos de streaming em tempo real (`message.updated.1`, deltas de chunks LLM e histórico de auditoria bruta) são desacoplados do banco relacional principal e persistidos como arquivos lineares `~/.local/share/opencode/workspaces/<workspace_hash>/transcripts/<session_id>.jsonl` via append atômico (`fs.appendFile`).

### 2. Particionamento de Banco por Workspace
- **Banco Global (`global.db`):** Armazena estritamente entidades globais do usuário e de autenticação (`account`, `control_account`, `credential` e o catálogo de índices de `project`). O banco global permanece perene com tamanho inferior a 2 MB.
- **Banco de Workspace (`workspaces/<workspace_hash>/project.db`):** Cada projeto/repositório possui sua própria instância isolada de banco SQLite local. Isso garante isolamento total de falha, elimina contenção de concorrência entre projetos simultâneos e permite backups ou limpeza granular por diretório.

### 3. Política Ativa de Higienização e Otimização do SQLite Existente
- Introduzir rotina periódica de *retention/pruning* que purga eventos transitórios de mensagens que já foram consolidadas nas tabelas `message`/`part`.
- Ajustar os PRAGMAs do SQLite:
  - Elevar `PRAGMA page_size = 16384;` nas novas bases para mitigar overflow pages de grandes payloads.
  - Habilitar `PRAGMA auto_vacuum = INCREMENTAL;` para permitir reclaim contínuo de espaço em disco sem lock exclusivo prolongado.

### Revisão pós-implementação (slices #269-#272): Política de Persistência Transiente

Após a avaliação arquitetural dos slices implementados, foi identificada uma inconsistência de integridade: o desvio de `message.updated.1` para JSONL manteve o avanço do ledger de sequência (`EventSequenceTable`) sem gravar a linha correspondente no `EventTable`, criando **lacunas no event log durável**. Isso quebrava o `replay` idempotente (morte por `Replay diverged`), o `sync history` e o barramento de sync de control-plane.

**Decisão revisada (desenho definitivo):**

1. **Política declarativa, não literal no motor.** A decisão de persistir um evento em JSONL deixa de ser o literal hardcoded `"message.updated.1"` no motor genérico de eventos (`event.ts`) e passa a ser uma propriedade do `definition` (ex.: `durable.transient = true`). O motor de eventos permanece agnóstico de domínio.
2. **Tombstone de continuidade.** Eventos transientes gravam uma linha leve (`id`, `aggregate_id`, `seq`, `type`, `data = {}`) no `EventTable`, preservando a contiguidade da sequência e em conformidade com o schema Drizzle (`data: text({ mode: 'json' }).notNull()`). O custo é desprezível: o inchaço original vinha do tamanho dos blobs de `data`, não da contagem de linhas.
3. **Replay idempotente por presença.** Para tipos transientes, a existência do tombstone em `(aggregate_id, seq)` significa "já aplicado" → no-op. Elimina a morte por divergência.
4. **Leitura ignora transientes.** `readAfter`/`readAggregate` pulam linhas transientes inspecionando formalmente a flag `transient` do manifesto/definição; esses eventos nunca foram consumidos pelo caminho local.
5. **Transientes fora do barramento de sync.** Por serem derivados e V1-only, não são emitidos no GlobalBus de sync.
6. **Descontinuação do destino JSONL (Fase Contract).** Como a projeção relacional consolidada (`message` + `part`) armazena a conversa completa com texto íntegro e é consumida diretamente pelos serviços locais (como o módulo de memória), o arquivo JSONL auxiliar tornou-se redundante. O writer em disco foi completamente removido, eliminando I/O fantasma de streaming e mantendo o `durable.transient` focado na gravação do tombstone leve no SQLite.
7. **Pruning sem quebra de tombstone.** O comando `db prune` converte eventos legados de `message.updated.1` com payload cheio em tombstones leves (`UPDATE event SET data = '{}' WHERE length(data) > 2`), sem executar `DELETE`. Dessa forma, o prune elimina os gigabytes de inchaço sem quebrar o sequenciamento `seq` nem o replay idempotente.

**Sem read-through / reconstrução a partir de JSONL.** Como `message.updated` (V1) está em rota de aposentadoria e o sync é local-only, não se constrói caminho de leitura retroativa: seria código morto para um evento em extinção. Quando o V1 for removido, o tipo transiente é eliminado por completo (fase *Contract*).

**Descopado:** particionamento dos transcripts por `workspace_hash`. `session_id` já é globalmente único; particionar o transcript é otimização de housekeeping, não requisito de correção, e fica como melhoria futura.

## Consequências

### Positivas
- **Latência Zero na UI:** Consultas para renderizar sessões, mensagens consolidadas e listas de projetos respondem em < 15ms, independentemente da duração ou tamanho do histórico.
- **I/O O(1) no Streaming de Tokens:** O streaming do LLM escreve diretamente no arquivo JSONL da sessão sem acionar transações ou concorrer com leitura da interface.
- **Isolamento de Domínio:** Corrupção de dados ou sessões gigantescas em um workspace não afetam workspaces vizinhos.
- **Diminuição Drástica do Tamanho em Disco:** O banco relacional por projeto se estabiliza em poucas dezenas de megabytes.

### Mitigações & Riscos
- **Zero Data Loss (Preservação Integral de Histórico):**
  - Todas as sessões, mensagens, partes e tarefas existentes no banco legado `opencode.db` devem ser mantidas intactas.
  - A migração adota a estratégia **Expand & Contract**:
    1. O sistema lê e reconhece o banco monolítico existente como fonte legada.
    2. Durante a transição, uma rotina de migração não destrutiva extrai as sessões consolidadas e as projeta nos respectivos bancos de workspace ou as mantém consultáveis transparentemente.
    3. Nenhum arquivo legado é deletado ou esvaziado automaticamente sem backup prévio e confirmação de integridade.
  - O pruning de eventos da Slice 1 afeta **apenas** eventos transitórios intermediários (`message.updated.1`) cujo conteúdo final já reside com 100% de integridade nas tabelas relacionais `message` e `part`, garantindo que toda a conversa visível continue idêntica.
- **Orquestração de Múltiplos Handlers SQLite:** O `Database.Service` deve resolver dinamicamente o cliente do banco com base no contexto do workspace ativo através do `LocationServiceMap`.
