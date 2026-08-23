---
name: opencode-fork-expert
description: Especialista no fork alltomatos/opencode — branches (prod/dev/batuta/breniac), o que é exclusivo deste fork (Batuta, Breniac, app desktop Electron) vs. o que vem do projeto original (anomalyco/opencode), processo de release, e como manter o fork sincronizado com novidades do upstream (correções de bugs, mudanças no harness/CLI, features novas). USE esta skill sempre que o usuário perguntar sobre o estado do repositório, branches, diferenças entre este fork e o original, "o que tem de novo no opencode original", "precisamos atualizar/sincronizar com o upstream", onde fica o código de alguma feature deste fork, ou pedir ajuda pra trazer uma correção do projeto original pra cá — mesmo que não use essas palavras exatas (ex.: "o build tá quebrado, será que já corrigiram isso lá no original?", "cadê o código do Breniac", "bump de versão", "esse bug já existia no upstream?").
---

# OpenCode Fork Expert

Este fork (`alltomatos/opencode`) parte do projeto original (`anomalyco/opencode`) e adiciona funcionalidades próprias — Batuta (orquestração multi-agente) e Breniac (assistente de voz) — além de manter um app desktop Electron com processo de release automatizado. Esta skill existe pra três coisas: (1) responder rápido sobre o estado do fork sem precisar re-descobrir tudo do zero a cada sessão, (2) checar e trazer novidades do upstream de forma segura, e (3) se manter atualizada — toda vez que você aprender algo novo sobre o fork que não está documentado aqui (uma convenção, um bug, uma mudança de processo), atualize os arquivos desta skill antes de terminar a tarefa.

## Como usar isto

1. **Primeiro, leia `references/fork-map.md`.** É o mapa cacheado do fork — branches, o que é exclusivo daqui, convenções de release, comandos-chave. Pra maioria das perguntas ("onde fica X", "como funciona o release", "o que Batuta faz") isso já basta, sem precisar rodar `git`/`gh` de novo.
2. **Se a pergunta exigir dado fresco** (branches podem ter avançado desde a última atualização deste arquivo — ele é um cache leve, não a fonte da verdade), rode as checagens ao vivo descritas em `references/fork-map.md` § "Verificar se este cache está desatualizado" antes de responder como se fosse certeza.
3. **Se a pergunta for sobre sincronizar com o upstream** (checar novidades, avaliar o que trazer, ou efetivamente aplicar), siga `references/upstream-sync.md` — tem o processo completo, incluindo o padrão de propagação usado neste fork (patch-based cherry-pick entre `batuta`→`dev`→`prod`, quando o commit não se aplica a todos os branches).
4. **Depois de qualquer descoberta nova** (um branch que sumiu, um processo que mudou, um bug recorrente, uma decisão do usuário sobre como algo deve funcionar), edite o(s) arquivo(s) relevante(s) desta skill pra refletir isso — não deixe o conhecimento só na conversa atual. Trate isso como parte da tarefa, não como opcional. Ao editar, atualize também a data em "última verificação" no topo do `fork-map.md`.

## Por que separar em dois arquivos de referência

- `fork-map.md` muda pouco (branches, convenções, onde as coisas ficam) — é o que você quer carregar quase sempre.
- `upstream-sync.md` é mais processual (passo a passo de como comparar/trazer mudanças) — só precisa ser lido quando a tarefa realmente envolve isso, pra não gastar contexto à toa em perguntas simples.

Se no meio do trabalho você perceber que um desses arquivos ficou grande ou confuso, é sinal de que vale quebrar em mais um arquivo de referência (ex.: `references/batuta.md`, `references/breniac.md`) em vez de inchar os dois existentes — mas só faça isso quando o conteúdo justificar, não preventivamente.
