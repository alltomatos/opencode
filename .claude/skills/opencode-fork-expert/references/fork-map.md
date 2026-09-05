# Mapa do fork alltomatos/opencode

**Última verificação:** 2026-08-23. Este arquivo é um cache leve — os fatos abaixo (versões, quem está à frente de quem) mudam com o tempo. Se a pergunta depender de um número exato e atual (versão publicada agora, quantos commits de diferença), confirme ao vivo (ver seção final) antes de responder como definitivo.

## Remotes

- `origin` → `https://github.com/alltomatos/opencode.git` (este fork)
- `upstream` → `https://github.com/anomalyco/opencode.git` (projeto original)

Ambos já configurados no clone local — não precisa adicionar de novo.

## Branches e o que cada um é

| Branch | Propósito |
| --- | --- |
| `prod` | **Única** branch que gera release publicado. `.github/workflows/release-desktop.yml` dispara automaticamente em todo push nessa branch, builda Windows/macOS/Linux em paralelo via GitHub Actions, publica um release (draft) no GitHub com os três instaladores + arquivos `latest*.yml` do auto-updater. |
| `dev` | Branch de desenvolvimento normal. Recebe trabalho novo antes de ser promovido pra `prod`. |
| `batuta` | Feature branch pra tudo relacionado à orquestração multi-agente Batuta (ver seção própria abaixo). Tende a ficar à frente de `dev`/`prod` em features específicas de Batuta ainda não promovidas. |
| `breniac` | Feature branch pro assistente de voz Breniac (ver `docs/prd/breniac-voice-assistant.md` na própria branch — o PRD só existe lá, não em `dev`/`prod` ainda). |

**Padrão de promoção:** commits de uma feature branch (`batuta`/`breniac`) só vão pra `dev`/`prod` quando o usuário explicitamente pede ("promova pra dev", "leva isso pra produção"). Commits específicos de uma feature branch nem sempre se aplicam limpos nos outros branches — ex.: um arquivo que só existe em `batuta` (como `packages/opencode/src/external-agent/index.ts`) não pode ser cherry-picked pra `dev`/`prod` se essas branches não têm esse arquivo. **Sempre confira se o commit toca arquivos que só existem na branch de origem antes de propagar** — cherry-pick seletivo (só os commits que fazem sentido) é o padrão aqui, não merge cego da branch inteira.

## O que é exclusivo deste fork (não existe no upstream)

- **Batuta** (orquestração multi-agente — orquestrador delega pra workers, incluindo agentes CLI externos):
  - Config: `packages/core/src/v1/config/batuta.ts`
  - Serviço de agente externo: `packages/opencode/src/external-agent/index.ts` (só existe na branch `batuta`)
  - Rotas HTTP próprias: `packages/opencode/src/server/routes/instance/httpapi/{handlers,groups}/batuta.ts`
  - UI: `packages/app/src/pages/batuta/` (form de atividade, cena de atividade ao vivo, lista lateral)
  - Nenhum cliente mobile de terceiros (OpenCode Mobile, etc.) sabe dessas rotas — ver `docs/prd/mobile-app.md`.
- **Breniac** (assistente de voz conversacional, foco em acessibilidade — na branch `breniac`):
  - PRD completo: `docs/prd/breniac-voice-assistant.md` (só nessa branch)
  - Rotas HTTP próprias: `packages/opencode/src/server/routes/instance/httpapi/{handlers,groups}/breniac.ts`
  - UI: `packages/app/src/components/breniac/`, `packages/app/src/context/breniac.tsx`
  - Escopo atual (definido no próprio PRD): desktop only, sem wake-word, sem mobile — ver `docs/prd/mobile-app.md` pra proposta de estender isso.
- **App Desktop (Electron)** — todo `packages/desktop/` é deste fork (upstream não tem app desktop Electron próprio nesse formato). Diferenciais recentes: botão "Abrir DevTools" e toggle "Modo debug" (Configurações → Avançado, habilita porta CDP remota mesmo em build empacotado), versão visível na sidebar (abaixo de "Ajuda").
- **Branding**: nome do app, ícones, changelog (`changelog.json` na raiz, em português) são deste fork.

## Processo de release (app desktop) — automatizado, não manual

Isto substitui qualquer nota antiga dizendo que o build/publish é manual — **não é mais**, desde que `.github/workflows/release-desktop.yml` foi criado neste fork:

1. Version bump em `packages/desktop/package.json` e `packages/app/package.json` (manter os dois sincronizados).
2. Entrada nova no topo de `changelog.json` (formato: array `releases`, cada um com `tag` e `highlights[].items[]`, em português).
3. Commit + push pra `prod` (via merge/cherry-pick de `dev`, nunca trabalho direto em `prod`).
4. O push dispara `release-desktop.yml` sozinho — builda os 3 SOs em paralelo, ~10-15min.
5. Verificar com `gh run list --repo alltomatos/opencode --workflow=release-desktop.yml --branch=prod --limit=1`.
6. O release sai como **draft** — publicar com `gh release edit v<versão> --repo alltomatos/opencode --draft=false`.

**Antes de fazer push em qualquer branch**, o hook de pre-push roda `bun turbo typecheck` no monorepo inteiro — não pule isso, é rápido (~10-50s com cache) e pega erro de tipo entre pacotes que só aparece na integração.

**Se for propagar pra um worktree novo** (`git worktree add /tmp/xxx <branch>`), lembre que ele não vem com `node_modules` — rode `bun install` lá antes do push (senão o hook de typecheck falha por falta de dependências, não por erro real).

## Convenções de commit e branch neste fork

- Nunca trabalhar direto em `prod` — sempre promover de `dev`/`batuta`/`breniac` via cherry-pick ou merge.
- Mensagens de commit em inglês, seguindo `tipo(escopo): resumo` (`fix(desktop):`, `feat(app):`, `docs:`, `chore(release):`), com corpo explicando o *porquê*, não só o *o quê* — este fork usa `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` no rodapé quando a mudança foi feita por IA.
- `docs/` na raiz é onde ficam documentos deste fork que não são upstream (PRDs em `docs/prd/`, guias como `docs/vps-hosting.md`). Não confundir com `packages/web/src/content/docs/` — esse é o site Starlight herdado do upstream (`opencode.ai/docs`), cujas mudanças não necessariamente ficam visíveis pra usuários deste fork (o README avisa que a documentação "oficial" seguida é a do projeto original).

## Armadilha: resolução de projeto por diretório é cacheada pra sempre

Descoberta ao vivo (não no código estático) construindo o app mobile deste fork, mas é um
comportamento do servidor que qualquer cliente novo (mobile, integração, script) vai bater —
válido tanto em `dev` quanto em `prod`.

**O bug de superfície**: um diretório novo é criado (`mkdir`/`git clone`), o cliente chama uma rota
qualquer com `?directory=<caminho>` (ex.: `GET /project/current`, `POST /session`) — e o "projeto"
resultante aparece como `id: "global"`, `worktree: "/"` ou some da lista depois de sair e voltar,
mesmo que o diretório tenha um repo git válido no disco.

**Causa real**: `packages/opencode/src/project/instance-store.ts` resolve a identidade do projeto
(`Project.fromDirectory` → `packages/core/src/project.ts` `resolve()`, que deriva o id de
`remote(repo) ?? previous ?? root(repo)`) **uma única vez por diretório, pro resto da vida do
processo do servidor**, e cacheia o resultado. Se o diretório for consultado **antes** de ter um
commit git (bare/vazio, ou `git init` ainda não rodou), fica preso pra sempre no projeto `"global"`
compartilhado. Rodar `git init`/`git commit` no disco *depois* não muda nada — nada reavalia
automaticamente.

**A cilada dentro da cilada**: `POST /project/git/init` (`packages/opencode/src/project/project.ts`,
`initGit`) é o mecanismo real de reparo — mas ele tem uma guarda: `if (input.project.vcs === "git")
return input.project`. Se o cache já registrou `vcs: "git"` (mesmo com o `id` errado — acontece
porque o campo `vcs` é recomputado a cada request independente do `id`), `initGit` acha que "já é
git, nada a fazer" e devolve o cache velho sem nunca corrigir o `id`.

**Sequência que funciona (confirmada ao vivo contra um servidor real)**:
1. `mkdir -p <path> && git -C <path> init && git -C <path> commit --allow-empty -m init` — **completo**
   antes de qualquer chamada HTTP com `?directory=<path>`.
2. Primeiro toque nesse diretório via `POST /project/git/init?directory=<path>` — **nunca**
   `GET /project/current` como primeiro toque (essa rota só lê o cache, nunca resolve/corrige).
3. Se ainda vier `id: "global"` (diretório já foi tocado antes por engano, cache já poluído):
   `POST /instance/dispose?directory=<path>` derruba o cache daquele diretório especificamente,
   depois um `initGit` novo resolve do zero. Não precisa reiniciar o servidor inteiro.

É exatamente isso que `packages/app/src/pages/home/home-controller.ts` (`project.add`) já faz —
lista os arquivos do diretório e chama `sdk.client.project.initGit` antes de tratar como projeto.
Qualquer cliente novo que pular esse passo (assumir que só passar `?directory=` em qualquer rota já
"registra" o projeto) vai reproduzir esse bug.

**Atualização**: pra só *listar* o que existe em diretórios conhecidos (sem precisar de um id de
projeto de verdade), `GET /file?directory=<pasta-mãe>&path=.` filtrando `type: "directory"` é mais
simples e não sofre nada disso — não depende de git nem de nenhuma resolução de projeto, só do
diretório existir no disco. O caminho `initGit`/`dispose` acima só é necessário se você
especificamente precisa do `id` de projeto do servidor pra alguma outra coisa (ex.: uma feature que
dependa da tabela `ProjectTable`).

## Armadilha: `POST /session/:id/shell` responde 200 mesmo quando o comando falha

O status HTTP dessa rota reflete "a mensagem foi processada", não "o comando saiu com código 0".
Testado ao vivo: um `git clone` de repositório privado sem credencial no servidor
(`fatal: could not read Username for 'https://github.com'`) devolve **200** — o erro real fica só
no texto da parte de tool (`ToolStateError.error` ou `ToolStateCompleted.output`, dependendo de como
o shell reporta a falha), nunca no status da resposta. Qualquer cliente que só confira `res.ok`
antes de considerar o comando bem-sucedido vai reportar sucesso falso pro usuário.

**Como verificar de verdade**: ou (a) parseie o texto retornado (`parts[].state.output`/`.error`)
procurando por sinais de erro, ou (b) mais confiável — encadeie um marcador único no fim do comando
com `&&` (ex.: `<comando> && echo ___OK___`), que só imprime se a cadeia inteira teve sucesso; a
ausência do marcador na saída = falha, e o texto capturado já traz o erro real (stderr) pra mostrar
ao usuário.

## Verificar se este cache está desatualizado

Antes de responder algo que dependa de estado atual exato, rode:

```bash
git fetch origin upstream
git branch -r | grep -E "origin/|upstream/(dev|main)$"   # confirma que as branches acima ainda existem com esses nomes
git log -1 --format="%H %ci" origin/prod                  # última versão publicada
grep '"version"' packages/desktop/package.json             # versão local atual
```

Se algo aqui não bater com o que está descrito acima, atualize este arquivo (não só responda o usuário e siga em frente — o próximo a usar esta skill vai herdar a informação errada se você não corrigir).
