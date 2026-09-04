# Arquitetura Expo/React Native — decisões e recomendações

Cache leve de decisões técnicas pro app mobile do fork. Fonte de verdade de produto/API continua em `docs/prd/mobile-app.md` e `docs/prd/mobile-api-reference.md` (neste repo) — este arquivo é só o "como", não o "o quê"/"por quê".

## Stack

- **Expo (managed workflow) + React Native.** Justificativa já registrada em `mobile-app.md` seção 7: é o que os dois clientes mobile de terceiros do OpenCode já usam em produção (validado), tem suporte maduro a microfone/áudio, notificações push, foreground services (Android) e WebView com WebGPU. Não reinventar essa escolha sem um motivo concreto novo.
- **TypeScript**, obviamente — pra poder compartilhar tipos com `packages/sdk/js`/`packages/protocol` deste fork (via npm, se publicado, ou copiando os `.d.ts` gerados).
- **Não usar SolidJS nem tentar portar `packages/app` diretamente** — é DOM/Solid, não dá pra rodar em React Native. Só os *contratos* (tipos, formato de rotas) são reaproveitáveis, não a UI.

## Autenticação e múltiplos servidores

- Guardar credenciais com `expo-secure-store` (Keychain/Keystore), nunca `AsyncStorage` puro — são credenciais de servidor (Basic Auth ou token), equivalente a senha.
- Modelar como lista de "servidores pareados" (mesmo conceito de `ServerConnection` do app desktop) — cada um com `{id, url, label, credential}`. Um servidor "ativo" por vez na navegação, mas a lista existe independente disso.
- Pareamento por QR code: usar `expo-camera` (ou `expo-barcode-scanner` se ainda suportado na versão do Expo em uso — checar deprecação) pra ler o QR, decodificar o payload JSON descrito em `mobile-api-reference.md` seção 4.

## Streaming de eventos (SSE)

- `EventSource` não é nativo no runtime do React Native/Hermes. Usar uma lib polyfill, ex. `react-native-sse` ou `react-native-event-source` — validar qual está mantida ativamente antes de fixar a escolha (checar no momento de implementar, não confiar nesta lista como definitiva).
- Reconexão: a conexão SSE cai quando o app vai pra background (mobile mata sockets ociosos agressivamente). Precisa de lógica de reconexão ao voltar pro foreground (`AppState` do RN) — refazer o `GET /event` e ressincronizar estado via as rotas de `GET` normais (ex. `GET /session/:id` de novo) antes de confiar só no stream.

## Áudio (Breniac, quando a branch for mergeada)

- Gravação/playback: `expo-av` (ou o substituto que a versão vigente do Expo recomendar — a API de áudio do Expo já mudou de nome mais de uma vez, checar changelog antes de fixar).
- Sessão de áudio em background no Android exige **foreground service com notificação persistente** — mesmo padrão de apps de música/GPS (já citado em `mobile-app.md` seção 5 pro harness on-device, mas vale igual pra uma sessão de voz Breniac longa). Sem isso, o Android mata o processo (phantom process killer, Android 12+).
- iOS: background audio precisa da capability `Background Modes → Audio` no `app.json`/`app.config.ts` do Expo, e o áudio precisa estar de fato tocando/gravando pra não ser suspenso — não dá pra manter uma conexão "ociosa" em background esperando o Breniac falar sem tocar nada.
- Streaming duplex de verdade (barge-in) é Fase 4 do PRD (`mobile-app.md` seção 8) — depende de WebSocket, seguindo o precedente já existente no backend (`handlers/pty.ts`, ver `mobile-api-reference.md` seção 5.6). Não é WebRTC — é o mesmo mecanismo de WebSocket que o terminal PTY já usa, só que carregando frames de áudio em vez de bytes de terminal.

## WebView / sandbox in-app (jogos e outros builds Web)

- `react-native-webview`, com a engine WebGPU/WebGL2 do navegador do sistema (Chrome no Android, Safari/WKWebView no iOS) — não embarcar nenhuma engine de jogo própria (ver `mobile-app.md` seção 6, já decidido).
- O backend serve o build estático (Godot/Babylon.js/Three.js export Web) — a WebView só aponta a URL desse endpoint. Nenhuma lógica de jogo roda "no app", só no WebView.

## Notificações push

- `expo-notifications`. Caso de uso principal: avisar quando uma tarefa Batuta em background termina, ou quando uma permission/question está esperando resposta (equivalente mobile do que o Telegram bot já faz hoje enviando mensagem com botões — ver `packages/opencode/src/telegram/index.ts`).
- Requer um servidor de push (Expo Push Service resolve o encaminhamento cross-platform) — o backend deste fork precisaria de um jeito de disparar isso quando os eventos `permission.asked`/`question.asked`/task-completed acontecerem. **Ainda não desenhado** — fica como item em aberto pra quando a Fase 1 chegar nesse ponto.

## O que ainda está em aberto (não decidir sem checar de novo)

- Harness on-device (Fase 3 do PRD): qual runtime rodar `packages/opencode` (Bun/TS) dentro de Android — maior risco técnico não resolvido, precisa de spike dedicada antes de qualquer escolha de lib aqui.
- Se o app vai (ou não) tentar reaproveitar `packages/sdk/js` diretamente via import, ou só os tipos — depende de testar compatibilidade com Hermes (ver `mobile-api-reference.md` seção 7).
