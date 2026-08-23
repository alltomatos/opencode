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

## 4. Depois de trazer algo

- Rode o typecheck completo (`bun turbo typecheck`) antes de dar push — o hook de pre-push já faz isso, mas rodar antes evita descobrir um conflito de tipo só na hora do push.
- Se a mudança trazida do upstream tocar em algo que este fork também modificou (ex.: um arquivo em `packages/app/src/pages/session.tsx`, que já teve fixes próprios deste fork nesta sessão), teste manualmente antes de considerar terminado — merge automático não garante que as duas mudanças coexistem bem em runtime, só que o texto não colidiu.
- Depois de sincronizar, deixe uma nota rápida aqui (ou em `fork-map.md`) se descobrir algo relevante sobre o estado do upstream que provavelmente importa de novo no futuro (ex.: "upstream mudou o formato do evento SSE em tal versão", "upstream removeu tal flag do CLI") — isso evita redescobrir a mesma coisa do zero na próxima sincronização.
