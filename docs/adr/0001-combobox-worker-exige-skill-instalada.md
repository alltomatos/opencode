# ADR 0001: Combobox de worker externo só lista agentes com a skill batuta-cli instalada

## Status
Aceito (2026-08-26)

## Contexto
O form de worker externo do Batuta (`packages/app/src/pages/batuta/activity-form.tsx`) vai ganhar um combobox que sugere CLIs de agente detectados no PATH (issue #76), substituindo o campo de texto livre atual. A dúvida era: o combobox deve sugerir qualquer agente detectado, ou só os que já têm a skill `batuta-cli` instalada (issue #77)?

Sem a skill `batuta-cli` instalada, o CLI de terceiro spawnado (`claude`, `codex`, etc.) não tem nenhum contexto de estar rodando sob orquestração do Batuta — não sabe como reportar progresso/conclusão de volta ao orquestrador. Delegar uma tarefa a um agente nesse estado produz um worker que "funciona" no sentido de rodar, mas se comporta de forma incompatível com o protocolo esperado pelo Batuta.

## Decisão
O combobox só habilita para seleção os agentes que estejam **simultaneamente**:
1. Detectados como instalados no servidor conectado (#74), e
2. Com a skill `batuta-cli` já instalada nesse mesmo servidor (#77).

Um agente detectado mas sem a skill aparece na lista como **desabilitado**, com um tooltip orientando a instalar a skill em Settings → Agentes.

Isso inverte a ordem de dependência original das issues: `#76` (combobox) passa a depender de `#77` (instalação de skill), não o contrário.

## Alternativas consideradas
- **Mostrar todos os agentes detectados, sem filtro por skill**: mais simples de implementar, mas permite configurar um worker que roda porém não interage corretamente com o orquestrador — falha silenciosa, descoberta só em runtime.
- **Mostrar todos, com aviso não-bloqueante**: meio-termo rejeitado por ainda permitir a configuração incorreta por padrão.

## Consequências
- Usuário precisa passar por Settings → Agentes antes de conseguir usar um CLI recém-instalado como worker externo — um passo a mais, mas evita configuração silenciosamente quebrada.
- A ordem de implementação das issues muda: #77 precisa estar pronta antes de #76.
