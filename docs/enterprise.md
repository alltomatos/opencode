# OpenCode Enterprise ("Teams")

Notas de pesquisa sobre `packages/enterprise` — o app que roda a oferta paga/self-hosted do
OpenCode, separada do CLI/app open-source usado no dia a dia. Este documento é local
(anotações de investigação), não faz parte da documentação pública do projeto.

## O que é

`packages/enterprise` é um app **SolidStart** independente que implementa o produto
**"Teams"**. Reaproveita `@opencode-ai/core`, `@opencode-ai/session-ui` e `@opencode-ai/ui`
(por isso compartilha coisas como `custom-elements.d.ts` com o pacote `ui`).

## Achados no código deste repositório

- App SolidStart próprio: `vite dev` / `vite build`, porta 3002 (`packages/enterprise/vite.config.ts`).
- Deploy declarado em `infra/enterprise.ts`:
  ```ts
  new sst.cloudflare.x.SolidStart("Teams", {
    domain: shortDomain,
    path: "packages/enterprise",
    buildCommand: "bun run build:cloudflare",
    link: [SECRET.SupportApiKey],
    environment: {
      OPENCODE_STORAGE_ADAPTER: "r2",
      OPENCODE_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
      OPENCODE_STORAGE_ACCESS_KEY_ID: SECRET.R2AccessKey.value,
      OPENCODE_STORAGE_SECRET_ACCESS_KEY: SECRET.R2SecretKey.value,
      OPENCODE_STORAGE_BUCKET: storage.name,
    },
  })
  ```
  Publicado como Cloudflare Worker, com um bucket R2 dedicado (`EnterpriseStorage`) e uma
  secret `SupportApiKey`.
- Núcleo funcional hoje: **compartilhamento de sessão**
  (`packages/enterprise/src/core/share.ts`). Define os tipos de dado compartilháveis —
  `session`, `message`, `part`, `session_diff`, `model` (validados via `zod`) — e persiste
  via um `Storage.Adapter` (`packages/enterprise/src/core/storage.ts`) que fala com a API
  S3-compatível do R2 usando `aws4fetch` (read/write/remove/list).
- Estado do código ainda é esqueleto: a rota raiz (`routes/index.tsx`) é literalmente
  `<div>Hello World</div>` — sinal de que está em construção/reestruturação, não é a versão
  final do produto.

## O que a documentação oficial (dev.opencode.ai) diz

- Destinado a organizações que exigem que **código e dados nunca saiam da própria
  infraestrutura**.
- Três pilares: configuração centralizada pra toda a org, **integração SSO** (Okta/Azure
  AD/Google Workspace), e um **gateway de IA interno** que roteia todas as requisições pela
  infra aprovada da empresa.
- Preço **por assento**, sem cobrança extra de tokens se a empresa usar seu próprio gateway
  de IA. Processo: trial interno → contato comercial pra cotação personalizada (preço não é
  publicado).

## Compartilhamento de sessão (doc `/share`)

Três modos configuráveis:

- **Manual** (padrão) — você aciona `/share` / `/unshare` explicitamente.
- **Auto-share** — toda sessão nova já sai compartilhada.
- **Desabilitado** — bloqueia tudo; recomendado para ambiente corporativo via
  `"share": "disabled"` no `opencode.json`.

O que é enviado ao compartilhar: histórico completo da conversa, diffs de arquivos
alterados (não os arquivos inteiros), metadados da sessão e listas de tarefas.

O que fica local: código completo, variáveis de ambiente, chaves de API, histórico Git e
configs globais.

O link é público sem autenticação até você rodar `/unshare` (invalida o link e apaga os
dados dos servidores em 24h).

Capacidades exclusivas de Enterprise:

- Compartilhamento **auto-hospedado** (dados na própria infra — exatamente o papel do
  `packages/enterprise` visto no código).
- Links protegidos por **SSO**.
- **Analytics** de acesso (contagem de views, logs de auditoria).

## Contexto mais amplo (comunidade/pricing)

Existe uma linha de planos de consumo separada (Free/Go/Pro/Zen) discutida em issues da
comunidade, mas é distinta do tier Enterprise — o Enterprise é vendido por
assento/negociação direta, não por esses planos self-service.

## Fontes

- [Enterprise | OpenCode](https://dev.opencode.ai/docs/enterprise/)
- [Session Sharing - OpenCode](https://anomalyco-opencode.mintlify.app/share)
- [Enterprise & Session Sharing | anomalyco/opencode | DeepWiki](https://deepwiki.com/anomalyco/opencode/7.2-enterprise-and-session-sharing)
- [OpenCode Enterprise Pricing (2026): Quote Reality, Cost Ranges, and Team Modeling](https://www.morphllm.com/opencode-enterprise-pricing)
- [[FEATURE]: Go Pro tier ($20) and Share modifier · Issue #24879 · anomalyco/opencode](https://github.com/anomalyco/opencode/issues/24879)
