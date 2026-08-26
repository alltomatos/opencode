# CLAUDE.md

## Módulo: Batuta — Agentes Externos

**Responsabilidade**: descoberta de quais CLIs de agente de terceiros (`claude`, `codex`, ...) estão instalados no servidor conectado, gestão de quais recebem a skill `batuta-cli`, e exposição dessa informação ao form de worker externo do Batuta.

**Invariantes**:
- Detecção e instalação de skill sempre rodam contra o servidor conectado (local ou remoto via HTTP) — nunca contra a máquina do cliente desktop.
- Detecção nunca spawna subprocesso (`which`/`where`) — só varre o PATH via `fs.stat`/`fs.access`, para não travar em ambientes com software de segurança que intercepta spawns.
- Um agente só aparece habilitável no combobox do form de worker (`activity-form.tsx`) se a skill `batuta-cli` já estiver instalada nele — sem a skill, o CLI não sabe como reportar progresso ao orquestrador Batuta (ver `docs/adr/0001-combobox-worker-exige-skill-instalada.md`).
- `externalAgent.selectedAgents` ausente = instalar em todos os detectados; presente = lista explícita. Nunca modelar como dois campos booleanos redundantes.

**O que NÃO fazer**:
- Não pedir confirmação extra por toggle ao instalar/remover a skill — o próprio toggle já é a ação.
- Não misturar o gate de "aparece no combobox" com o status bruto de detecção — são coisas diferentes (detecção é sempre completa e reporta todo agente conhecido; o combobox filtra por skill instalada).
