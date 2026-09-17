# CLAUDE.md

## Módulo: Providers — dois sistemas paralelos (v1 `packages/opencode` vs v2 `packages/core`)

**Responsabilidade**: resolver qual SDK/adapter fala com o provider de LLM de fato durante o chat.

**Invariantes**:
- O app desktop hoje roda o runtime **v1** (`packages/opencode/src/provider/provider.ts`, resolução via `npm`/`resolveSDK`, sem Effect). O runtime **v2** (`packages/core/src/session/runner/*`, catálogo Effect-based) ainda é incompleto (`SessionRunnerModel.fromCatalogModel` só suporta `@ai-sdk/openai`/`@ai-sdk/anthropic`/`@ai-sdk/openai-compatible`) e não está no caminho real de uma mensagem de chat enviada pelo app.
- Um plugin v2 em `packages/core/src/plugin/provider/*.ts` (ex: `google-antigravity.ts`) registra OAuth + card no catálogo v2, mas isso sozinho **não conecta a chamada real** — para provider com protocolo proprietário (não é REST puro compatível com `@ai-sdk/*`), o fetch customizado precisa ser injetado no bridge v1↔v2: `Provider.syncCatalogModel` em `packages/opencode/src/provider/provider.ts`. `fromCatalog()` sempre zera `info.options = {}`; só o merge de credencial OAuth dentro de `syncCatalogModel` (bloco `if (credential?.type === "oauth")`) sobrevive até o `resolveSDK` que o chat realmente usa.
- Existe também um `custom()` loader mais antigo em `provider.ts` (mapa por `providerID`, ex. as entradas `google-antigravity`/`google-antigravity-cli`) que parece o lugar óbvio para colocar overrides de `fetch`/`apiKey` — mas ele só roda se `database[providerID]` (catálogo estático de `models.dev` + config) já existir. Provider registrado só via plugin v2 (sem entrada em `models.dev`/config) faz esse loader ser pulado silenciosamente; qualquer `fetch`/opção colocada ali fica morta. Ver caso real: `antigravity-adapter.ts` (interceptor do protocolo Code Assist) só passou a ser usado depois de mover a injeção para `syncCatalogModel`.
- Para depurar "provider conectado mas chat falha" sem log nenhum aparecendo: a mensagem NÃO viaja por request HTTP visível por chamada — o app abre uma conexão SSE única (`event`, endpoint tipo `/global/event` ou `/session/.../event`) na inicialização; `prompt_async` só dispara (204, fire-and-forget) e o resultado real (incluindo `session.error`) chega como evento nessa stream. No DevTools do Electron, abra Network → Preserve log → recarregue a janela → filtre por `event` → aba **EventStream** → filtre por `error` dentro dela.

**O que NÃO fazer**:
- Não assumir que editar `packages/core/src/plugin/provider/*.ts` resolve um bug de chat — primeiro confirmar se o app está no runtime v1 ou v2 (checar de onde vem `provider.getLanguage`/`SessionRunnerModel`).
- Não confiar em "o provider aparece no seletor do app" como prova de que o adapter de inferência está correto — o catálogo (nome, modelos, card OAuth) e a chamada de chat de fato são bridges completamente separados.

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

## Iniciativa: Tech Debt — divisão de arquivos grandes (`packages/app/src`)

**Responsabilidade**: reduzir arquivos monolíticos de `packages/app/src` em módulos menores por responsabilidade, sem alterar comportamento.

**Rastreamento**: issues rotuladas `tech-debt` no GitHub (alltomatos/opencode) — #13, #14, #15, #16, #17, #18, #19. Trabalho sequencial, uma issue por vez/PR.

**Invariantes**:
- `pages/layout.tsx` (#13) e `context/layout.tsx` (#18) NÃO devem ser divididos antes do épico #25 (descontinuação do layout legado / `newLayoutDesigns()`) avançar — dividir agora é trabalho descartável, pois o épico planeja deletar/reescrever esses arquivos por completo. Priorizar as fatias independentes do épico #25 primeiro: #19, #17, #16, #15, #14.
- Cada issue vira slices pequenos (idealmente um PR por issue, commits menores dentro dela), verificados manualmente no preview antes de prosseguir — nunca um PR monolítico misturando múltiplas issues de split.
- Divisão de arquivo é refatoração pura: nenhuma mudança de comportamento/UX deve acompanhar o split. Se um bug for encontrado durante o split, abrir issue separada — não corrigir dentro do PR de refactor.
- Após cada split, `/qa-analyst` deve confrontar app antes/depois (sem regressão visual/funcional) antes de abrir PR.

**O que NÃO fazer**:
- Não iniciar #13 ou #18 sem antes checar o status do épico #25.
- Não abrir uma única issue/PR cobrindo dois arquivos grandes ao mesmo tempo — mantém rastreabilidade 1:1 com a issue do GitHub.
