# Sincronizar com o upstream (anomalyco/opencode)

O upstream é ativo e evolui muito rápido (centenas de branches de feature em paralelo — não estranhe o volume ao listar `upstream/*`). A maior parte do valor de ficar em dia com ele vem do **core compartilhado**: correções de bug no agente, no harness/CLI, no protocolo, no SDK, providers/models novos — coisas que este fork não reimplementa, só herda. Mudanças de UI do app original tendem a importar menos, já que este fork tem sua própria camada de UI (Electron desktop, Batuta, Breniac).

## 1. Checar o que tem de novo

```bash
git fetch upstream
git log --oneline dev..upstream/dev | head -50      # commits no upstream que ainda não estão no nosso dev
git log --oneline dev..upstream/dev -- packages/opencode/src packages/core/src   # filtrar só core/CLI/harness
```

Se o resultado for grande, priorize por pasta — mudanças em `packages/opencode/src/session/`, `packages/opencode/src/tool/`, `packages/core/src/` (o motor do agente e o harness de tools) importam mais pra este fork do que mudanças em `packages/web/` (site) ou em partes de UI que este fork já substituiu por conta própria.

Pra achar especificamente correções de bug (não features), procure por mensagens de commit com `fix(`, `fix:`, ou abra o histórico de um arquivo específico que você sabe que dá problema:

```bash
git log upstream/dev --oneline --grep="^fix" -- packages/opencode/src/session/
```

## 2. Avaliar o que trazer

Nem tudo do upstream deve vir pra cá. Antes de aplicar algo, pergunte:

- **É correção de bug no core (agente, harness, providers, protocolo)?** Quase sempre vale trazer — é a categoria de maior retorno, baixo risco de conflito com as customizações deste fork (que ficam concentradas em `packages/app` e `packages/desktop`).
- **É uma feature nova de UI do app original (packages/app, componentes)?** Avaliar com mais cuidado — pode conflitar com as telas próprias deste fork (Batuta, Breniac, settings reorganizados). Merge de UI tende a gerar mais conflito que merge de core.
- **É algo específico do produto original que não faz sentido aqui** (branding, telemetria deles, features que competem com Batuta/Breniac)? Não trazer.

Quando em dúvida sobre uma mudança específica, mostre o diff resumido pro usuário e pergunte antes de aplicar — não presuma.

## 3. Aplicar

Duas rotas, dependendo do tamanho:

**Merge direto** (quando é sincronização geral, não uma mudança isolada):

```bash
git checkout dev
git merge upstream/dev
# resolver conflitos — priorizar preservar customizações deste fork em packages/app e packages/desktop
bun turbo typecheck
git push origin dev
```

**Cherry-pick de commits específicos** (quando é só uma correção pontual que você quer trazer sem puxar tudo mais do upstream junto):

```bash
git fetch upstream
git log upstream/dev --oneline -- <caminho-do-arquivo-com-o-bug>   # achar o commit que corrigiu
git cherry-pick <hash>
bun turbo typecheck
```

Depois de sincronizar `dev`, propague pra `batuta`/`breniac`/`prod` seguindo o mesmo padrão de cherry-pick seletivo descrito em `fork-map.md` (nem todo commit se aplica a toda branch).

## Fila pendente de sincronização (última checagem: 2026-09-13, scheduled task)

Checagem automática (sem usuário ao vivo) comparando `origin/dev` (HEAD `c2ecb852a`) contra `upstream/dev`. **Clone raso por padrão nesta sessão** — foi preciso `git fetch --unshallow origin` antes de confiar em `git merge-base`/`git rev-list`, senão os números saem sem sentido (chegou a aparecer "15717 commits atrás" por falta de histórico comum visível).

- Merge-base real: `3a31c4ea8` (2026-08-22, bate com a "última verificação" registrada em `fork-map.md` na época).
- `origin/dev` está 248 commits à frente do merge-base (trabalho próprio deste fork) e **202 commits atrás** de `upstream/dev`.
- Só 30 desses 202 tocam `packages/opencode/src` ou `packages/core/src` (o resto é produto próprio do anomalyco — console, Go, Zen, stats, billing — não relevante aqui). `git log --oneline origin/dev..upstream/dev -- packages/opencode/src packages/core/src` reproduz a lista.

Nenhum destes foi aplicado ainda — **aguardando aprovação explícita do usuário antes de qualquer cherry-pick/merge**, conforme pedido da tarefa que gerou esta checagem. Classificação por prioridade:

**Tier A — correções pequenas e de baixo risco, candidatas a ir primeiro:**
- `765ae641d` fix(core): time.start resetava errado no logging de tool call
- `69c172e8a` fix(provider): trata rejection no cancelamento do SSE reader
- `f7da00f35` fix(opencode): omite move path vazio no apply_patch
- `b04697366` + `4eb29a64f` fix(opencode): timeout default de header/chunk pra 5min

**Tier B — relevantes, mas exigem leitura antes de aplicar (tocam área sensível ou têm mais de um commit encadeado):**
- `3f39a329c` → `9a71624d2` → `68abdce1a` — cadeia de 3 commits sobre "Anthropic thinking blockBinding" (reasoning do Claude). Relevante pra este fork (uso pesado de Claude/Sonnet/Opus com thinking) — aplicar os três juntos, não isolado.
- `611cc73d8` fix(opencode): envia header de parent session — checar se colide com o tracking de sessão do Batuta.
- `b72b50006` fix(core): recupera histórico de migração de DB legado — checar compatibilidade com schema local antes de aplicar.
- `95daf9067` fix(acp) + `a9a6fad0f` fix(opencode) — reasoning/session bounds, ACP e adaptive thinking.
- `02a167e04` + `500c46ec7` — comparação de versão do Codex GPT — relevante pq Batuta suporta `codex` como agente externo.
- `517ee736b` fix(provider) + `ac1758c0e` fix — Bedrock (só relevante se algum usuário deste fork usa Bedrock).
- `03afae5b9` feat(opencode): carrega config v2 suportada dentro do v1 (449 linhas novas em `config/v2-compat.ts`) — mudança grande, avaliar conflito com `packages/core/src/v1/config/batuta.ts` antes de trazer.

**Tier C/D — específico de provider não usado ou produto do anomalyco, não trazer a menos que peçam:** Azure (`af1f9e626`, `216ba8f05`, `733562e92`, `790fb5b86`), GitLab (`7c2199d84`), Cloudflare AI Gateway (`3ef72fe8f`, `f8b4dd70a`), Copilot header (`c0f09afef`), GitHub OIDC (`f4019cab3`), upgrade endpoint (`2a3623613` — só relevante se afetar auto-update do CLI, não confundir com o auto-update do app desktop Electron que é deste fork), `5cd8e68fd` (system prompt "Astra", branding do produto original), e tudo de billing/console/Go/Zen.

**Próximo passo:** com aprovação do usuário, começar pelo Tier A (baixo risco), depois avaliar Tier B item a item — nunca em lote. Depois de cada cherry-pick: `bun turbo typecheck` e propagar seletivamente pra `batuta`/`breniac`/`prod` conforme o padrão de `fork-map.md`.

## 4. Depois de trazer algo

- Rode o typecheck completo (`bun turbo typecheck`) antes de dar push — o hook de pre-push já faz isso, mas rodar antes evita descobrir um conflito de tipo só na hora do push.
- Se a mudança trazida do upstream tocar em algo que este fork também modificou (ex.: um arquivo em `packages/app/src/pages/session.tsx`, que já teve fixes próprios deste fork nesta sessão), teste manualmente antes de considerar terminado — merge automático não garante que as duas mudanças coexistem bem em runtime, só que o texto não colidiu.
- Depois de sincronizar, deixe uma nota rápida aqui (ou em `fork-map.md`) se descobrir algo relevante sobre o estado do upstream que provavelmente importa de novo no futuro (ex.: "upstream mudou o formato do evento SSE em tal versão", "upstream removeu tal flag do CLI") — isso evita redescobrir a mesma coisa do zero na próxima sincronização.
