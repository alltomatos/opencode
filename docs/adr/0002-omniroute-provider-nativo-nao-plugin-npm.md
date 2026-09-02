# ADR 0002: OmniRoute vira Native Provider Plugin, não um pacote npm externo vendorizado

## Status
Aceito (2026-08-26)

## Contexto
Existe um pacote npm externo (`@omniroute/opencode-plugin`, repo `diegosouzapw/OmniRoute`) que implementa o contrato v1 de plugin do opencode (`AuthHook`/`ProviderHook`/`ConfigHook` de `packages/plugin`) para integrar o AI Gateway OmniRoute: descoberta dinâmica de `/v1/models` com cache TTL e auto-sync em background, fluxo `/connect`, combos como pseudo-modelos, multi-instância, enrichment de preço/nome, sanitização de schema Gemini, auto-emissão de entrada MCP.

Nosso fork já tem essa integração, mas como um diálogo bespoke (`dialog-connect-omniroute.tsx`) que roda inteiramente no cliente: faz um fetch único de `/models` no momento do "Conectar" e grava um snapshot estático em `provider.omnrt.models` no `opencode.json`. Sem refresh, sem TTL, sem descoberta de novos modelos até o usuário reconectar manualmente.

A pergunta era: portar a lógica do pacote npm mantendo o contrato v1 externo (só que vendorizado dentro do nosso repo), ou reescrever seguindo o padrão que o fork já usa para todo outro provider (Anthropic, OpenAI, Groq, Gateway, ...) — módulos nativos Effect-based em `packages/core/src/plugin/provider/*.ts`, registrados em `ProviderPlugins`, usando `ctx.catalog.transform` (registro de providers/modelos) e `ctx.aisdk.sdk` (fábrica do SDK), com `Reload` para descoberta periódica.

## Decisão
Portar como **Native Provider Plugin** (`packages/core/src/plugin/provider/omniroute.ts`), seguindo exatamente o padrão já estabelecido — não manter o contrato v1 externo, nem como pacote vendorizado.

A UI (`dialog-connect-omniroute.tsx`) simplifica para só coletar credencial (baseURL + API key) e disparar `auth.set` + `Catalog Reload` — toda a lógica de parsing/model-config que hoje vive no cliente migra pro plugin nativo.

## Alternativas consideradas
- **Vendorizar mantendo o contrato v1 (`AuthHook`/`ProviderHook`)**: mais próximo do código-fonte original, menor esforço de tradução inicial. Rejeitado porque criaria dois sistemas de plugin ativos fazendo a mesma coisa (contrato v1 para OmniRoute, nativo Effect-based para todo o resto) — inconsistência arquitetural permanente, mais superfície de manutenção, e o contrato v1 não tem acesso direto aos serviços internos do fork (Catalog, Config, etc.) do jeito que o nativo tem via `ctx`.
- **Manter como está (diálogo bespoke, snapshot estático)**: mais simples, zero trabalho. Rejeitado porque é a causa raiz do problema — sem descoberta dinâmica, sem TTL/auto-sync, modelos novos no gateway só aparecem depois de reconexão manual.

## Consequências
- A lógica de fetch/parse de modelos sai do bundle do app (frontend) e vai para o servidor (packages/core) — reduz superfície client-side, mas exige que o servidor tenha acesso de rede ao `baseURL` configurado (já é o caso hoje, é o mesmo servidor que faz outras chamadas de provider).
- Recursos do plugin original que dependem de estado por-instância (multi-instância via `providerId` configurável) ficam fora do escopo desta primeira fatia — o fork continua com um único provider `omnrt` fixo até uma issue futura decidir generalizar.
- O escopo é fatiado em "core" (auth + discovery dinâmico + combos, paridade com o que já existe hoje só que dinâmico) e "extras" (enrichment, sanitização Gemini, MCP auto-emit, allowlist) como issues separadas — decisão tomada para manter cada PR pequena e revisável, não uma migração monolítica de 5700+ linhas de uma vez.
