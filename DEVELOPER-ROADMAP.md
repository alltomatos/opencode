# Developer Roadmap

GitHub (`alltomatos/opencode`, branch default `dev`) é a fonte persistente de rastreamento e governança; este arquivo é a bússola estratégica do projeto.

---

## Epics

| ID | Objetivo | Estado | Issue GitHub |
| --- | --- | --- | --- |
| [**[E01] Evolução de UI/UX Alltomatos**](https://github.com/alltomatos/opencode/issues/1) | Menus consistentes, destaque de ações destrutivas e polish de telas de configuração | done | [#1](https://github.com/alltomatos/opencode/issues/1) |
| [**[E02] Redução de Débito Técnico e Limite SRP**](https://github.com/alltomatos/opencode/issues/13) | Decomposição oportunística de arquivos >250 linhas para respeitar Single Responsibility Principle | in_progress | [#13](https://github.com/alltomatos/opencode/issues/13) |
| [**[E03] Melhorias e Catálogo de Servidores MCP**](https://github.com/alltomatos/opencode/issues/21) | Catálogo de servidores conhecidos, navegação de ferramentas e fluxo de OAuth persistido | done | [#21](https://github.com/alltomatos/opencode/issues/21) |
| [**[E04] Batuta — Orquestração de Subagentes**](https://github.com/alltomatos/opencode/issues/26) | Orquestração de subagentes (V1 interna + V2 externa com CLI/PTY + V3 DAG e terminal ao vivo) | in_progress | [#26](https://github.com/alltomatos/opencode/issues/26) |
| [**[E05] Descontinuar Layout Legado**](https://github.com/alltomatos/opencode/issues/25) | Remoção completa de `newLayoutDesigns()` e `pages/layout.tsx` (~32 arquivos impactados) | todo | [#25](https://github.com/alltomatos/opencode/issues/25) |
| [**[E06] Build Multi-plataforma e CI de Release**](https://github.com/alltomatos/opencode/issues/39) | Build e publicação automática multi-plataforma (Windows/macOS/Linux) via GitHub Actions na branch `prod` | done | [#39](https://github.com/alltomatos/opencode/issues/39) |
| [**[E07] Design System v2 e Passes de Consistência**](https://github.com/alltomatos/opencode/issues/178) | Migração para tokens `--v2-*`, contraste de cores e padronização visual de modais e dialogs | in_progress | [#178](https://github.com/alltomatos/opencode/issues/178) |
| [**[E08] Mobile VPS API e Pareamento Remoto**](https://github.com/alltomatos/opencode/issues/59) | Backend para clientes remotos/mobile com endpoints Effect REST, Bearer auth e WebSocket streaming | done | [#59](https://github.com/alltomatos/opencode/issues/59) |
| [**[E09] Server Remoto e Gestão de Hosts**](https://github.com/alltomatos/opencode/issues/78) | Suporte a múltiplos ambientes remotos com `EnvironmentRegistry`, sincronização de credenciais e PTY remoto | done | [#78](https://github.com/alltomatos/opencode/issues/78) |
| [**[E10] Integração com Telegram Bot**](https://github.com/alltomatos/opencode/issues/127) | Ponte de comunicação bidirecional com Telegram (long-polling, webhook e sessões mapeadas) | in_progress | [#127](https://github.com/alltomatos/opencode/issues/127) |
| [**[E11] Memória Centralizada do Fork**](https://github.com/alltomatos/opencode/issues/137) | Sistema unificado de memória episódica/semântica extraído do Breniac para todas as sessões e agentes | done | [#137](https://github.com/alltomatos/opencode/issues/137) |
| [**[E12] AgentUI — Agentes Personalizados**](https://github.com/alltomatos/opencode/issues/144) | Criação de agentes conversacionais customizados com canais, guardrails, prompts e RAG | done | [#144](https://github.com/alltomatos/opencode/issues/144) |
| [**[E13] CI Flaky e Isolamento de Testes**](https://github.com/alltomatos/opencode/issues/181) | Eliminação de testes instáveis no Windows/Linux, isolamento de camadas e estabilização de suítes | in_progress | [#181](https://github.com/alltomatos/opencode/issues/181) |
| [**[E14] Sincronização com Upstream Anomalyco**](https://github.com/alltomatos/opencode/issues/200) | Port de correções e patches estáveis do repositório upstream mantendo compatibilidade | done | [#200](https://github.com/alltomatos/opencode/issues/200) |
| [**[E15] Dashboard de KPIs & Estatísticas de Uso de Tokens (/stats)**](https://github.com/alltomatos/opencode/issues/212) | Painel central de métricas agregadas de consumo de tokens (input/output/reasoning/cache) e custos | in_progress | [#212](https://github.com/alltomatos/opencode/issues/212) |

---

## Milestones

### M1: Foundation & Desktop UI Consistency
- **Objetivo:** Estabelecer estabilidade de componentes, reduzir débito técnico estrutural e automatizar pipelines de release do app desktop.
- **Epics vinculadas:**
  - [**[E01] Evolução de UI/UX Alltomatos**](https://github.com/alltomatos/opencode/issues/1) (`done`)
  - [**[E02] Redução de Débito Técnico e Limite SRP**](https://github.com/alltomatos/opencode/issues/13) (`in_progress`)
  - [**[E03] Melhorias e Catálogo de Servidores MCP**](https://github.com/alltomatos/opencode/issues/21) (`done`)
  - [**[E06] Build Multi-plataforma e CI de Release**](https://github.com/alltomatos/opencode/issues/39) (`done`)
- **Estado:** `in_progress`

### M2: Agent Orchestration & Intelligence
- **Objetivo:** Potencializar a autonomia do agente através de orquestração multi-agente (Batuta), memória persistente cross-session e criação de personas customizadas (AgentUI).
- **Epics vinculadas:**
  - [**[E04] Batuta — Orquestração de Subagentes**](https://github.com/alltomatos/opencode/issues/26) (`in_progress`)
  - [**[E11] Memória Centralizada do Fork**](https://github.com/alltomatos/opencode/issues/137) (`done`)
  - [**[E12] AgentUI — Agentes Personalizados**](https://github.com/alltomatos/opencode/issues/144) (`done`)
- **Estado:** `in_progress`

### M3: Remote Access & Mobile Ecosystem
- **Objetivo:** Habilitar o ecossistema móvel e remoto através de APIs desacopladas para VPS, pareamento por token/QR code e canal de mensageria via Telegram.
- **Epics vinculadas:**
  - [**[E08] Mobile VPS API e Pareamento Remoto**](https://github.com/alltomatos/opencode/issues/59) (`done`)
  - [**[E09] Server Remoto e Gestão de Hosts**](https://github.com/alltomatos/opencode/issues/78) (`done`)
  - [**[E10] Integração com Telegram Bot**](https://github.com/alltomatos/opencode/issues/127) (`in_progress`)
- **Estado:** `in_progress`

### M4: Design System v2 & Legacy Sunset
- **Objetivo:** Migrar integralmente o app para o Design System v2 com remoção segura do layout legado e padronização semântica de tokens visuais.
- **Epics vinculadas:**
  - [**[E05] Descontinuar Layout Legado**](https://github.com/alltomatos/opencode/issues/25) (`todo`)
  - [**[E07] Design System v2 e Passes de Consistência**](https://github.com/alltomatos/opencode/issues/178) (`in_progress`)
- **Estado:** `in_progress`

### M5: Platform Reliability & Observability
- **Objetivo:** Blindar o pipeline de testes contra flakiness, manter sincronia com o upstream e fornecer observabilidade de uso e custos de IA.
- **Epics vinculadas:**
  - [**[E13] CI Flaky e Isolamento de Testes**](https://github.com/alltomatos/opencode/issues/181) (`in_progress`)
  - [**[E14] Sincronização com Upstream Anomalyco**](https://github.com/alltomatos/opencode/issues/200) (`done`)
  - [**[E15] Dashboard de KPIs & Estatísticas de Uso de Tokens (/stats)**](https://github.com/alltomatos/opencode/issues/212) (`in_progress`)
- **Estado:** `in_progress`
