# Referência de API — App Mobile do fork (contrato de engenharia)

**Status:** Documentação viva (não é o app — o app nasce em outro repositório)
**Complementa:** [`mobile-app.md`](./mobile-app.md) (visão de produto) — este documento é o contrato técnico: toda rota que o app mobile vai precisar consumir, autenticação, descoberta/pareamento de servidor, e o que falta construir no backend antes da Fase 1 do PRD poder começar.
**Branch de origem deste documento:** `mobile-vps-api`
**Última atualização:** 2026-09-04

---

## 1. Por que este documento existe

O `mobile-app.md` decide *se* vale construir o app e *o que* ele deveria fazer. Este documento responde à pergunta seguinte, mais concreta: **quando alguém for escrever esse app (React Native/Expo, em outro repositório), o que exatamente ele vai chamar, e o que ainda não existe e precisa ser construído aqui neste fork antes disso?**

Este fork nasceu como Telegram bot primeiro (`packages/opencode/src/telegram/index.ts`) porque era a forma mais rápida de validar "dá pra operar Batuta/Breniac remotamente, em background, com aprovação de permissão assíncrona". Funcionou bem como prova de conceito, mas **o Telegram não é suficiente pro app mobile de verdade**: não dá streaming de voz duplex, não dá UI rica (lista de atividades Batuta, diffs, sandbox 3D), não dá um app com ícone/notificação push própria, e a API do Bot do Telegram não foi desenhada pra isso. O caminho certo é o app falar direto com a API HTTP+SSE do opencode — o mesmo contrato que o app desktop e a `tui` já usam — mais as rotas exclusivas deste fork (Batuta, Memory, e futuramente Breniac).

## 2. Autenticação

Todo o `InstanceHttpApi` (ver `packages/opencode/src/server/routes/instance/httpapi/api.ts`) passa por `Authorization` middleware (`packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`), que aceita duas formas, nessa ordem de prioridade:

1. **HTTP Basic Auth** — `Authorization: Basic base64(usuario:senha)`. A senha é o que foi setado em `OPENCODE_SERVER_PASSWORD` no servidor (ver [`docs/vps-hosting.md`](../vps-hosting.md)).
2. **Query param** `?auth_token=<token>` — usado hoje por rotas que não conseguem mandar header custom facilmente (ex. WebSocket de PTY, ou um link direto). **Este é o mecanismo que o QR code de pareamento (seção 4) deve reaproveitar** — encoda a URL do servidor com o token já embutido.

Não existe OAuth/JWT nem sessão de login separada — é autenticação de servidor único (mesmo modelo usado pelo app desktop hoje: "Configurações → Servidores" guarda usuário+senha por servidor).

## 3. Descoberta e tipos de servidor

O app desktop já suporta múltiplos tipos de conexão simultâneos (`packages/app/src/context/server.tsx`, tipo `ServerConnection.Any`):

| Tipo | Como conecta | Relevância pro mobile |
| --- | --- | --- |
| `http` | URL direta (VPS, Tailscale, rede local) | **É o único tipo que o app mobile precisa suportar na Fase 1.** Basta host+porta+credencial. |
| `sidecar` (WSL) | Processo local via IPC do Electron | Não aplicável a mobile — é específico do desktop Windows. |
| `ssh` | Túnel SSH gerenciado pelo Electron | Não aplicável a mobile como está hoje (gerenciado por processo desktop) — se o app mobile quiser suportar túnel SSH, precisa de uma lib RN própria (ex. `react-native-ssh-sftp`), fora de escopo da Fase 1. |

**Conclusão pra Fase 1 do app mobile:** só precisa implementar o cliente `http` — é o mesmo formato que o app desktop já usa pra VPS/Tailscale, e é o que o pareamento por QR code (seção 4) deve gerar.

O app suporta múltiplos servidores simultâneos hoje (lista de `ServerConnection`, cada um com seu próprio `scope`) — o app mobile deve replicar esse modelo: **N servidores pareados, um selecionado/ativo por vez ou lado a lado**, exatamente como pedido.

## 4. Pareamento por QR code — implementado no app desktop (2026-09-04)

Como o `auth_token` já É exatamente `base64(usuário:senha)` (seção 2) — a mesma credencial que o app desktop já guarda pra cada servidor configurado — o pareamento por QR code não precisou de nenhum endpoint novo no backend. Foi implementado **inteiramente no app desktop**: em Configurações → Servidores → menu "..." de um servidor → **Ver QR code**, renderiza um QR (lib `qrcode`) com o payload abaixo, mais um botão "Copiar dados de pareamento" (mesmo JSON, pra colar manualmente se não der pra escanear).

- Código: `packages/app/src/components/settings-v2/dialog-server-qr-code.tsx` (gera o payload e renderiza), `packages/app/src/components/server/server-row-menu.tsx` (item de menu).
- **Cuidado de segurança**: o QR code carrega a credencial completa do servidor — é equivalente a mostrar a senha. A UI já avisa isso na descrição do dialog.

### 4.1 Payload do QR code

Formato proposto (JSON compacto, para caber num QR code legível em qualquer celular — evitar payloads grandes):

```json
{
  "v": 1,
  "url": "https://minha-vps.exemplo.com:4096",
  "token": "<auth_token de uso único ou de longa duração>",
  "label": "Servidor da VPS"
}
```

- `v`: versão do formato do payload (permite evoluir sem quebrar apps antigos).
- `url`: mesma URL que o app desktop já usa em "Adicionar servidor".
- `token`: reaproveita o mecanismo `?auth_token=` que já existe (seção 2) — **não** a senha em texto puro, pra poder ser revogado/expirado independentemente da senha do servidor.
- `label`: nome de exibição opcional.

### 4.2 Limitação conhecida (decisão de produto em aberto)

O token embutido no QR é de vida longa e escopo total — não existe (ainda) um mecanismo de token de pareamento efêmero/escopo restrito, diferente da senha real do servidor. Se isso for um problema (ex. querer revogar o acesso de um app mobile sem trocar a senha de todo mundo), precisa de um endpoint novo de emissão de token com expiração/escopo próprio — não construído nesta etapa, pois a v1 prioriza "funciona hoje, sem mudar o backend" sobre esse refinamento.

### 4.3 O que o app mobile faz ao ler o QR code

1. Decodifica o JSON.
2. Faz uma chamada de teste (`GET /instance` ou equivalente — ver seção 5.1) usando `url` + `?auth_token=<token>` pra validar que o servidor responde e a credencial é válida.
3. Salva como um novo `ServerConnection` local (mesmo modelo de "N servidores" do app desktop).
4. Troca o `auth_token` de pareamento (efêmero) por uma credencial de longa duração armazenada localmente — **a decidir**: ou o token de pareamento já É de longa duração e fica salvo como está, ou o passo 3 troca por usuário+senha reais (mais seguro, mas exige mais um endpoint de "trocar token por credencial permanente").

## 5. Mapa de rotas — API padrão (mesma que desktop/TUI usam)

Base: `packages/opencode/src/server/routes/instance/httpapi/`. Todas exigem `directory` ou `workspace` como query param em quase toda rota (`WorkspaceRoutingMiddleware` — roteia pro projeto/workspace certo; ver `middleware/workspace-routing.ts`). O app mobile precisa saber, por sessão de uso, qual `directory` está ativo (equivalente a "qual projeto está aberto" no desktop).

### 5.1 Sessão (`groups/session.ts`, prefixo `/session`)

| Ação | Método + rota |
| --- | --- |
| Listar sessões | `GET /session` |
| Status (ativa/ociosa) | `GET /session/status` |
| Detalhe de uma sessão | `GET /session/:sessionID` |
| Sessões filhas (subagents) | `GET /session/:sessionID/children` |
| Todo list da sessão | `GET /session/:sessionID/todo` |
| Diff acumulado | `GET /session/:sessionID/diff` |
| Listar mensagens | `GET /session/:sessionID/message` |
| Uma mensagem | `GET /session/:sessionID/message/:messageID` |
| Criar sessão | `POST /session` |
| Remover sessão | `DELETE /session/:sessionID` |
| Atualizar (título, etc.) | `PATCH /session/:sessionID` |
| Fork (ramificar sessão) | `POST /session/:sessionID/fork` |
| Abortar geração em andamento | `POST /session/:sessionID/abort` |
| Inicializar (AGENTS.md, etc.) | `POST /session/:sessionID/init` |
| Compartilhar / descompartilhar | `POST` / `DELETE /session/:sessionID/share` |
| Resumir sessão | `POST /session/:sessionID/summarize` |
| **Enviar prompt (síncrono)** | `POST /session/:sessionID/message` |
| **Enviar prompt (assíncrono)** | `POST /session/:sessionID/prompt_async` — provavelmente o que o app mobile quer, pra não segurar uma conexão HTTP longa; acompanha via `GET /event` (5.2). |
| Rodar comando de skill | `POST /session/:sessionID/command` |
| Rodar comando de shell | `POST /session/:sessionID/shell` |
| Reverter / desfazer revert | `POST /session/:sessionID/revert` / `/unrevert` |
| Responder a uma permission da sessão | `POST /session/:sessionID/permissions` |
| Apagar mensagem/parte | `DELETE /session/:sessionID/message/:id` / `.../part/:id` |
| Editar parte de mensagem | `PATCH /session/:sessionID/message/:id/part/:id` |

### 5.2 Eventos em tempo real (`groups/event.ts`)

`GET /event` — Server-Sent Events (SSE). É como o app fica sabendo, em tempo real, de tudo: progresso de geração, permission.asked, question.asked, mudanças de sessão. **Toda a UI reativa do app mobile depende desse canal** — não dá pra fazer polling decente sem ele. RN/Expo tem suporte a SSE via `EventSource` (polyfill se necessário, ex. `react-native-sse`).

### 5.3 Permissões e perguntas (`groups/permission.ts`, `groups/question.ts`)

Equivalente mobile do que o Telegram bot já faz com botões inline (`sendApprovalRequest`/`sendQuestion` em `telegram/index.ts`) — mas numa UI nativa:

| Ação | Método + rota |
| --- | --- |
| Listar permissões pendentes | `GET /permission` |
| Responder permissão | `POST /permission/:requestID/reply` |
| Listar perguntas pendentes | `GET /question` |
| Responder pergunta | `POST /question/:requestID/reply` |
| Rejeitar pergunta | `POST /question/:requestID/reject` |

Ambas também chegam via SSE (`permission.asked`, `question.asked`) — o fluxo é: evento chega → app mostra dialog nativo → usuário responde → `POST .../reply`.

### 5.4 Projeto e arquivos (`groups/project.ts`, `groups/file.ts`)

| Ação | Método + rota |
| --- | --- |
| Listar projetos | `GET /project` |
| Projeto atual | `GET /project/current` |
| Iniciar git num diretório | `POST /project/git/init` |
| Atualizar metadados (nome, ícone) | `PATCH /project/:projectID` |
| Diretórios de um projeto | `GET /project/:projectID/directories` |
| Buscar texto | `GET /find` |
| Buscar arquivo por nome | `GET /find/file` |
| Buscar símbolo | `GET /find/symbol` |
| Listar arquivos | `GET /file` |
| Conteúdo de um arquivo | `GET /file/content` |
| Status (git) | `GET /file/status` |

### 5.5 Provedores, modelos e config (`groups/provider.ts`, `groups/config.ts`)

| Ação | Método + rota |
| --- | --- |
| Listar provedores/modelos conectados | `GET /provider` |
| Status de auth por provedor | `GET /provider/auth` |
| Iniciar OAuth de um provedor | `POST /provider/:providerID/oauth/authorize` |
| Callback OAuth | `POST /provider/:providerID/oauth/callback` |
| Ler config | `GET /config` |
| Atualizar config | `PATCH /config` |
| Provedores disponíveis (catálogo) | `GET /config/providers` |

### 5.6 MCP e PTY (`groups/mcp.ts`, `groups/pty.ts`)

Provavelmente **fora de escopo pra Fase 1 mobile** (MCP é configuração avançada; PTY é terminal interativo — tecnicamente possível via WebSocket em RN, mas não é prioridade pra um app voice-first). Documentado aqui só pra registro:

- MCP: `GET /mcp/status`, `POST /mcp` (add), `DELETE /mcp/:id`, fluxo de auth OAuth próprio (`authStart`/`authCallback`/`authAuthenticate`), `GET /mcp/catalog`.
- PTY: `GET /pty` (list), `POST /pty` (create), `GET/PUT/DELETE /pty/:id`, conexão via `GET /pty/connect` (WebSocket) com token (`POST /pty/:id/connect-token`) — é o precedente de streaming duplex já citado no `mobile-app.md` (seção 7) pra quando Breniac migrar pra WebSocket de áudio.

## 6. Rotas exclusivas deste fork

### 6.1 Batuta (`groups/batuta.ts`, prefixo `/batuta`)

Orquestração multi-agente — é a peça que nenhum cliente mobile de terceiros enxerga (ver `mobile-app.md` seção 2).

| Ação | Método + rota |
| --- | --- |
| Listar atividades | `GET /batuta` |
| Criar atividade | `POST /batuta` |
| Remover atividade | `DELETE /batuta/:id` |
| Iniciar atividade | `POST /batuta/:id/start` |
| Sincronizar (git) | `POST /batuta/:id/sync` |
| Listar branches disponíveis | `GET /batuta/branches` |
| Disparar execução | `POST /batuta/:id/dispatch` |
| Ler definição de pipeline | `GET /batuta/:id/pipeline-definition` |
| Definir pipeline | `PUT /batuta/:id/pipeline-definition` |
| Delegar (orquestrador → worker) | `POST /batuta/:id/delegate` |
| Iniciar chat de pipeline | `POST /batuta/:id/pipeline-chat` |

A "visualização própria" mobile-native pedida no PRD (seção 3, item 2) mapeia direto pra essa lista: uma tela de lista de atividades (`GET /batuta`) + detalhe/status em tempo real (via SSE) + ação de delegar. Não precisa da cena 3D do desktop — texto/cards já resolve.

### 6.2 Memória (`groups/memory.ts`, prefixo `/memory`)

Novo (ver épico #137, concluído nesta sessão) — cross-sessão, global + por projeto:

| Ação | Método + rota |
| --- | --- |
| Ler config de memória | `GET /memory` |
| Atualizar config | `PUT /memory` |
| Checar se um projeto tem memória | `GET /memory/project?directory=...` |
| Esquecer memória de um projeto | `DELETE /memory/project?directory=...` |

O app mobile provavelmente só precisa espelhar a tela "Configurações → Memória" do desktop (toggle + modelo) — a maior parte do valor de memória já chega de graça via as tools `memory_search`/`memory_save` que o modelo chama sozinho durante qualquer sessão, sem o app precisar fazer nada especial.

### 6.3 Breniac — **ainda não existe na branch `dev`/`mobile-vps-api`**

O PRD do Breniac (`docs/prd/breniac-voice-assistant.md`) e o código (`packages/opencode/src/server/routes/instance/httpapi/{handlers,groups}/breniac.ts`) vivem só na branch `breniac`, ainda não promovida. **Antes do app mobile poder usar voz Breniac, essa branch precisa ser mergeada** (e, idealmente, sua lógica de memória migrada pro `Memory.Service` genérico — ver nota em issue #138). Documentar o contrato exato de Breniac fica pendente até isso acontecer; por ora, o `mobile-app.md` já cobre a visão (voz como interface primária, seção 3.1).

### 6.4 External Agent (`groups/external-agent.ts`, prefixo relacionado a agentes externos)

Detecção de CLIs de terceiros (`claude`, `codex`, etc.) instalados no servidor — ver módulo "Batuta — Agentes Externos" no `CLAUDE.md` deste repo. Provavelmente irrelevante pro app mobile na Fase 1 (é uma feature de configuração do worker, não de uso direto).

## 7. SDK — não reimplementar chamadas HTTP na mão

Como já registrado no `mobile-app.md` (seção 7): o app mobile deve consumir `packages/sdk/js` (o cliente TypeScript já gerado a partir do `HttpApi` deste fork — mesmo mecanismo usado por `packages/app` e `packages/cli`), não reimplementar `fetch()` pra cada rota. Duas ressalvas técnicas a validar na spike técnica da Fase 1:

- `packages/sdk/js` foi feito pra rodar em Node/Bun/browser — precisa confirmar compatibilidade com o runtime do Expo (Hermes) antes de assumir que "importa e funciona". Se não for direto, pelo menos os **tipos** (`packages/sdk/js/src/v2/gen/types.gen.ts`) continuam valiosos pra tipar chamadas `fetch` manuais sem perder o contrato.
- O SDK atual não inclui as rotas de Batuta/Memory automaticamente — confirmar que `script/build.ts` do SDK (mesmo processo usado nesta sessão pra regenerar depois de adicionar `/memory`) cobre `/batuta` também antes de assumir que já está exposto.

## 8. Resumo do que falta construir aqui (neste fork) antes da Fase 1 do app mobile

1. ~~Pareamento por QR code~~ — **feito** (seção 4), 2026-09-04.
2. **Token de pareamento com escopo/expiração próprios** (seção 4.2) — hoje o QR carrega a credencial real de vida longa; construir uma variante efêmera é opcional, só se virar requisito de produto.
3. **Confirmar cobertura do SDK** pra `/batuta` e `/memory` (seção 7).
4. Nada mais bloqueia a Fase 1 no backend — sessão, evento, permissão/pergunta, projeto, provider, config, Batuta e Memory já estão todos expostos e documentados acima.
