---
name: expo-expert
description: Especialista em React Native + Expo aplicado ao futuro app mobile deste fork (OpenCode + Batuta + Breniac) — arquitetura de app cliente que fala com a API HTTP+SSE do opencode, pareamento de servidor por QR code, múltiplos servidores, streaming de eventos (SSE/EventSource), voz/áudio (Expo AV, foreground services Android), e WebView com WebGPU/WebGL2 pra sandbox in-app. USE esta skill sempre que o trabalho for sobre o app mobile deste fork — planejar sua arquitetura, escrever código Expo/React Native pra ele (em outro repositório), decidir qual API consumir, desenhar o fluxo de pareamento, ou revisar decisões técnicas de stack mobile — mesmo que o pedido não mencione "Expo" explicitamente (ex.: "como o app vai escanear o QR code", "isso funciona em background no Android?", "o app consegue tocar áudio do Breniac assim").
---

# Expo Expert (app mobile do fork)

Esta skill existe porque o app mobile deste fork **não vive neste repositório** — nasce em outro, pra não misturar o código do servidor/desktop com o de um app React Native. Mas o planejamento e o contrato de API que esse app vai consumir *vivem aqui*, porque dependem diretamente do que o backend (`packages/opencode`) expõe. Esta skill é o elo entre os dois: garante que qualquer trabalho de app mobile — mesmo feito noutro repo, noutra sessão — parta do contrato certo.

## Como usar isto

1. **Leia primeiro os dois documentos-fonte deste fork:**
   - [`docs/prd/mobile-app.md`](../../../docs/prd/mobile-app.md) — a visão de produto: por que construir, o que os concorrentes não fazem, as 4 fases propostas, a persona-âncora (acessibilidade por voz é requisito, não extra).
   - [`docs/prd/mobile-api-reference.md`](../../../docs/prd/mobile-api-reference.md) — o contrato técnico: toda rota HTTP/SSE que o app vai chamar, autenticação, o desenho (ainda não implementado) do pareamento por QR code, e o que falta construir no backend antes da Fase 1 poder começar de verdade.
2. **Se o pedido for sobre o app mobile em si** (arquitetura RN/Expo, telas, navegação, áudio, notificações, WebView) — use `references/expo-architecture.md` pra decisões de stack já tomadas/recomendadas, e os dois PRDs acima pra saber *o que* construir.
3. **Se o pedido for sobre pareamento por QR code** especificamente — `mobile-api-reference.md` seção 4 tem o payload proposto e o que falta no backend. Isso é trabalho que cruza os dois repositórios (endpoint novo aqui + tela de scanner lá); avise que uma metade depende da outra antes de prometer prazo.
4. **Depois de qualquer decisão nova** (uma escolha de lib, um padrão de tela, uma mudança no contrato de API que o app passou a exigir), atualize `references/expo-architecture.md` — não deixe a decisão só na conversa. Se a mudança afeta o *contrato de API* (não só o app), atualize também `mobile-api-reference.md` neste repo.

## O que esta skill NÃO faz

Não implementa código de app mobile diretamente neste repositório — este repo não tem (e não deveria ganhar) um `packages/mobile`. Se o pedido for "cria o app", a resposta certa é: apontar pro PRD, confirmar o escopo da Fase 1, e sugerir criar/abrir o repositório separado — não começar a escrever componentes RN aqui dentro.
