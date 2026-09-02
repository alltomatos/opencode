# Batuta — Agentes Externos

Contexto estruturado para agentes trabalhando nas issues #73-#77 (GitHub, repo `alltomatos/opencode`, label `batuta`).

## Responsabilidades

1. Registro estático de CLIs de agente conhecidos (#73).
2. Detecção de instalação via scan de PATH, sem spawn (#74).
3. Seção "Agentes" nas Settings com badge de status + toggles de seleção (#75).
4. Instalação/remoção da skill `batuta-cli` nos agentes selecionados e detectados (#77).
5. Combobox de agentes no form de worker do Batuta, filtrado por skill instalada (#76).

## Contratos

- `GET /external-agent/detect` → `{ id: string, installed: boolean }[]`, um item por agente em `KNOWN_EXTERNAL_AGENTS`. Roda contra o servidor conectado.
- Setting `externalAgent.selectedAgents?: string[]` — ausente = todos os detectados; array = seleção explícita.
- Skill `batuta-cli` instalada em `<pasta-do-provider>/skills/batuta-cli/` no servidor conectado, uma entrada por agente que esteja simultaneamente detectado E selecionado.

## Ordem de dependência

```
#73 (registro) → #74 (detecção + rota) → #75 (Settings) → #77 (instalar skill) → #76 (combobox do form)
```

`#76` depende de `#77` porque o combobox só habilita um agente depois que a skill dele foi instalada (ver ADR 0001).

## Edge cases decididos

- **Servidor remoto**: detecção e instalação sempre no servidor conectado, nunca no cliente desktop (mesma lógica de `ServerConnection.builtin` vs `local` corrigida no PR #66).
- **Binário desinstalado depois da detecção**: fica desatualizado até o usuário clicar "Atualizar" — comportamento aceito no v1.
- **Múltiplos workers usando o mesmo agente**: sem estado exclusivo, é só leitura de detecção — não é um caso especial.
- **Agente detectado mas sem skill**: aparece desabilitado no combobox do form, com tooltip apontando para Settings → Agentes.
- **Escrita da skill**: o toggle já é a confirmação — sem dialog extra por mudança.

## Critério de sucesso por issue

- **#73**: `bun run typecheck` limpo + teste sem `id` duplicado.
- **#74**: teste unitário com `fs` mockado (presente/ausente/PATH vazio) + `curl GET /external-agent/detect` retornando JSON válido contra um servidor real.
- **#75**: teste manual — badges corretos, toggle mestre liga todos, toggle individual desliga um.
- **#77**: ligar toggle para `claude` cria `~/.claude/skills/batuta-cli/SKILL.md` no servidor conectado; desligar remove.
- **#76**: só agentes com skill instalada aparecem habilitados no combobox; detectado-sem-skill aparece desabilitado com tooltip.
