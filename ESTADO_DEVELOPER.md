# ESTADO_DEVELOPER

> Persistência de progresso e governança da DAG do Developer.
> Documenta GAPs identificados, DAG de execução e status.

---

## Sessão

- **iniciado_em**: `2026-09-16 17:15:00`
- **atualizado_em**: `2026-09-17 12:30:00`
- **fase_atual**: `Fase 4 (Execução)`
- **repositorio**: `alltomatos/opencode`
- **epic_github**: `https://github.com/alltomatos/opencode/issues/248`
- **branch_trabalho**: `dev` (promovido a `prod` em `2026-09-17`, commit `2cc744ff83`)

---

## GAPs Identificados (Handoff OAuth Multi-Account)

| # | ID | Dimensão | Severidade | Descritivo | Tier Risco | Status |
|---|----|----------|------------|------------|------------|--------|
| 1 | `GAP-001` | Arquitetura / Resiliência | P1 | Rotação sem gatilho automático: `markUnavailable` nunca chamado em 429/quota | T2 Batchável | 🟢 done (corrigido de verdade — ver nota abaixo) |
| 2 | `GAP-002` | Funcionalidade | P2 | Sem inferência real: falta adaptador de stream/completions (Antigravity/Kiro/Kilo) | T3 Bloqueante | 🟡 parcial — Antigravity 🟢 done, Kiro/Kilo 🔴 pendente |
| 3 | `GAP-003` | Integração | P3 | URL social do Kiro não verificada contra bundle Electron real | T2 Batchável | 🟡 queued |
| 4 | `GAP-004` | Débito Técnico | P2 | Sync do SDK `@opencode-ai/client` pendente (contornado via `integration-fetch.ts`) | T3 Bloqueante | 🟡 queued |
| 5 | `GAP-005` | Integração | P3 | `AGY` (Antigravity IDE) não onboarda projeto Cloud Code via API — `onboardUser` 403 mesmo com `ideType: "ANTIGRAVITY"` correto | T3 Bloqueante | 🟡 queued |

**Nota sobre GAP-005**: confirmado ao vivo em `2026-09-17` que o erro "#3501 sem licença" no AGY (perfil IDE) não é bug de metadata — testado `pluginType: "GEMINI"` e `ideType: "ANTIGRAVITY"`, ambos retornam 403 `PermissionDenied` no `onboardUser` pra contas sem projeto Cloud Code pré-vinculado, mesmo a conta funcionando no app oficial do Antigravity IDE. Hipótese: o app oficial vincula o projeto via um passo interativo (escolher/criar projeto no navegador) que a chamada de API sozinha não reproduz. **AGY CLI não é afetado** (tolera o fallback de projeto genérico `aicode-consumers`) e está confirmado funcionando ponta a ponta. Usar AGY CLI como caminho recomendado até isso ser investigado mais a fundo (precisaria de MITM do app oficial pra ver a sequência completa de chamadas do primeiro login).

**Nota importante sobre GAP-001**: o commit `db0293ce8b` (marcado "done" na sessão anterior) implementou o benching automático apenas em `packages/core/src/session/runner/*` — esse é o runtime **v2**, que não está no caminho real de execução do app desktop (confirmado nesta sessão via debugging ao vivo). O fix real, que efetivamente entra em produção, foi feito em `2026-09-17` no runtime **v1** (`packages/opencode/src/provider/antigravity-adapter.ts`, função `benchConnectionOnFailure`, reusando `IntegrationRotation.isBenchableFailure`). Ver módulo "Providers — dois sistemas paralelos" em `CLAUDE.md` para o porquê dessa armadilha.

---

## Tarefas (Fase 4 — Fila DAG)

### Convenção de ID
- `TASK-<NNN>` — identificador único.
- `depends_on: ["TASK-<MMM>", ...]` — dependências predecessoras.

### Tarefas

```yaml
- id: TASK-001
  desc: "Conectar hook de erro de requisição (429/quota) ao IntegrationRotation.markUnavailable"
  issue: "https://github.com/alltomatos/opencode/issues/249"
  skill: /tdd
  gap_ref: GAP-001
  depends_on: []
  status: done
  concluido_em: "2026-09-16 17:40:00"
  nota: "Implementado apenas no runtime v2 (dead code) — ver TASK-005."

- id: TASK-002
  desc: "Implementar adaptador de inferência real para Google Antigravity (IDE + CLI)"
  skill: /diagnose
  gap_ref: GAP-002
  depends_on: [TASK-001]
  status: done
  concluido_em: "2026-09-17 11:00:00"
  detalhe: >
    Bug raiz: Provider.syncCatalogModel (packages/opencode/src/provider/provider.ts)
    nunca injetava o fetch customizado do Code Assist no bridge OAuth->provider v1;
    a chamada real caía no @ai-sdk/google genérico e 404 na Google. Corrigido
    injetando createAntigravityFetch ali. Commits: 72498ab30e, be70cca52c.
    Testado em produção pelo usuário — "sucesso".

- id: TASK-005
  desc: "Portar benching automático de 429/quota do v2 (dead code) pro runtime v1 real + proteção proativa de 95% de cota"
  skill: /tdd
  gap_ref: GAP-001
  depends_on: [TASK-002]
  status: done
  concluido_em: "2026-09-17 12:00:00"
  detalhe: >
    checkQuotaAndBenchIfLow() consulta POST /v1internal:retrieveUserQuota (campo real
    remainingFraction do Google, cache 90s) e bencheia a conta em <=5% restante.
    benchConnectionOnFailure() reage a 429/RESOURCE_EXHAUSTED real reusando
    IntegrationRotation.isBenchableFailure. Fail-open em erro de rede/parse.
    Commit: 0ea4b295f1. Promovido a prod em 2026-09-17 (2cc744ff83).

- id: TASK-003
  desc: "Verificar OAuth do Kiro (Builder ID primeiro, depois Social/IdC/Import) e registrar modelos no catálogo v1"
  skill: /diagnose
  gap_ref: GAP-002, GAP-003
  depends_on: []
  status: ready
  proximo_passo: "Usuário vai testar conexão via Builder ID no app; paralelamente registrar catalog.provider.api/models em kiro.ts (hoje só tem OAuth, zero modelos no catálogo)."

- id: TASK-004
  desc: "Auditar breaking changes para sync do SDK @opencode-ai/client em packages/app"
  skill: /diagnose
  gap_ref: GAP-004
  depends_on: []
  status: ready
```

---

## Log de Ações Auto-Aplicáveis (Tier T1)

| # | Data | GAP | Ação | Resultado |
|---|------|-----|------|-----------|
| 1 | 2026-09-16 | - | Validação suíte testes core OAuth/Rotation | 38 pass, 0 fail |
| 2 | 2026-09-16 | GAP-001 | Implementar hook de erro 429/quota + benching automático no runner (v2, dead code) | 54 pass, typecheck ok, commit db0293ce8b |
| 3 | 2026-09-17 | GAP-002 | Diagnóstico + fix do adapter real de chat do Google Antigravity (bridge `syncCatalogModel`) | typecheck ok, testado em prod pelo usuário: funciona |
| 4 | 2026-09-17 | GAP-001 | Proteção de cota a 95% + rotação real em 429/quota no runtime v1 | typecheck ok, commit 0ea4b295f1, promovido a prod (2cc744ff83) |
