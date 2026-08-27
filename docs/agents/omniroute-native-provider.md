# OmniRoute — Native Provider Plugin

Contexto estruturado para agentes trabalhando na fatia "core" do port nativo do OmniRoute (ver ADR 0002).

## Responsabilidades

1. Registrar o provider `omnrt` no catálogo dinamicamente (não mais snapshot estático) — Native Provider Plugin em `packages/core/src/plugin/provider/omniroute.ts`.
2. Descoberta de `/v1/models` com cache TTL, recarregada via `Catalog Reload` (auto-sync em background).
3. Combos (`owned_by === "combo"`) registrados como pseudo-modelos.
4. Simplificar `dialog-connect-omniroute.tsx` para só coletar credencial e disparar `auth.set` + reload.

Fora de escopo desta fatia (issues futuras): enrichment de preço/nome, sanitização de schema Gemini, auto-emissão de entrada MCP, allowlist de modelos, multi-instância via `providerId` configurável.

## Fonte de referência

Plugin externo `@omniroute/opencode-plugin` (repo `diegosouzapw/OmniRoute`, branch `release/v3.8.51`, path `@omniroute/opencode-plugin`) — `src/index.ts` (~5713 linhas), `src/naming.ts` (~295 linhas), `src/logger.ts` (~82 linhas). Usar como referência de comportamento (formato de resposta do gateway, regras de nomeação de combos, capabilities pass-through), não como código a copiar literalmente — a tradução para o contrato nativo (`ctx.catalog.transform`, `ctx.aisdk.sdk`) muda a forma de boa parte da lógica.

## Contratos

- `packages/core/src/plugin/provider/omniroute.ts`: `Native Provider Plugin` com `id: "omniroute"`, registrado em `ProviderPlugins` (`packages/core/src/plugin/provider.ts`).
- Descoberta usa o `baseURL`/API key já persistidos via `auth.set` para o provider `omnrt` (mesmo mecanismo de credencial usado hoje).
- Capabilities pass-through: o formato de resposta do OmniRoute (`capabilities.vision/tool_calling/reasoning/thinking/temperature`, `input_modalities`/`output_modalities`) é a fonte de verdade — sem heurística client-side reconstruindo capacidades.
- `dialog-connect-omniroute.tsx` simplificado: só `baseURL` + `apiKey`, chama `auth.set` e um reload do catálogo (não mais fetch/parse de modelos no cliente).

## Edge cases decididos

- **Combos vs modelos reais**: diferenciação (`owned_by === "combo"`) só afeta capacidades default (LCD) e nomeação — mecanismo de registro no catálogo é o mesmo.
- **Falha de discovery** (gateway offline, key inválida): mantém o último catálogo válido em memória, não limpa os modelos já registrados — mesma filosofia de "Unavailable Context" já documentada em CONTEXT.md pra outras fontes dinâmicas.
- **Multi-instância**: fora de escopo desta fatia — fica fixo em um único provider `omnrt`.

## Critério de sucesso por issue

- **Registro/descoberta dinâmica**: `bun run typecheck` limpo + teste com fetch mockado confirmando que o catálogo é populado a partir da resposta de `/v1/models`.
- **Auto-sync em background**: teste confirmando que um segundo `Catalog Reload` após o TTL atualiza o catálogo sem exigir reconexão manual.
- **UI simplificada**: diálogo salva só credencial; teste manual confirma que os modelos aparecem no seletor sem passar pela lógica antiga de parse client-side.
