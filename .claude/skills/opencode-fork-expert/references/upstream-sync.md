# Sincronizar com o upstream (anomalyco/opencode)

O upstream é ativo e evolui muito rápido (centenas de branches de feature em paralelo — não estranhe o volume ao listar `upstream/*`). A maior parte do valor de ficar em dia com ele vem do **core compartilhado**: correções de bug no agente, no harness/CLI, no protocolo, no SDK, providers/models novos — coisas que este fork não reimplementa, só herda. Mudanças de UI do app original tendem a importar menos, já que este fork tem sua própria camada de UI (Electron desktop, Batuta, Breniac).

## ⚠️ Históricos git não relacionados desde 2026-09-11

`origin/dev` e `upstream/dev` **não têm ancestral comum** — `git merge-base origin/dev upstream/dev` não retorna nada. O upstream provavelmente reescreveu/squashou o histórico deles em algum momento após o fork original ter sido criado. Isso significa que `git log dev..upstream/dev` **não é um diff incremental confiável** — ele lista o histórico inteiro deles (dezenas de milhares de commits), não só o que é novo. As versões de pacote continuam próximas (ex.: fork em `1.18.21` vs upstream em `1.18.30` em 2026-09-11), então o conteúdo não divergiu tanto quanto o número de commits sugere — só o log de commits que quebrou.

Também nota: upstream parou de taggear releases no git depois de `v1.4.x` — não dá pra usar tags pra achar o ponto de versão equivalente.

**Use diff de árvore/conteúdo, não histórico de commits**, para comparar:

```bash
git fetch upstream
git diff origin/dev upstream/dev -- packages/opencode/src/session packages/opencode/src/tool packages/core/src
```

Pra achar correções de bug específicas, o histórico do upstream em si está intacto (só não compartilha ancestral com o nosso) — filtre por `fix(` nas mensagens de commit deles:

```bash
git log upstream/dev --oneline --grep="^fix" -- packages/opencode/src/session/ packages/opencode/src/tool/ packages/core/src/
```

Depois, pra confirmar se uma correção específica já está presente no fork ou não, o jeito mais rápido e confiável é comparar byte-a-byte:

```bash
git log --all --oneline -- <arquivo>      # candidatos que tocaram esse arquivo (nos dois remotes)
git show <hash-upstream> -- <arquivo>     # o que a correção fez lá
diff <(git show <hash-upstream>:<arquivo>) <(cat <arquivo>)   # o que falta aqui
```

## 1. Checar o que tem de novo (quando o histórico compartilhado existir de novo, ou pra outras branches)

```bash
git fetch upstream
git log --oneline dev..upstream/dev | head -50      # só funciona se houver ancestral comum — ver aviso acima
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

**Cuidado com correções já parcialmente portadas**: este fork às vezes tem a mesma lógica duplicada em dois lugares — uma versão "canônica" num pacote core (ex.: `packages/core/src/plugin/provider/amazon-bedrock.ts`, `packages/core/src/aisdk.ts`) e uma cópia legada dentro de `packages/opencode/src/provider/provider.ts` (o loader "custom" antigo e seu próprio `wrapSSE()`). Uma sessão de sync anterior pode ter corrigido só a cópia canônica e esquecido a duplicada — antes de assumir que uma correção específica já foi trazida, dê um `grep` pelo padrão corrigido no repo inteiro, não só no arquivo que o commit do upstream tocou (foi o caso de PR #241, que completou os ports de `ac1758c0e6` e `69c172e8a7` feitos por PR #199/commits `d66cefea74`/`ac3b15ba8d`).

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
- **Ambientes sandbox (sessões remotas/cloud) costumam bloquear certas fontes de dependência via proxy** — `pkg.pr.new` e tarballs diretos de `api.github.com/repos/.../tarball/...` retornam 403 nesses ambientes, o que quebra a instalação/typecheck de pacotes que fixam dependências nessas fontes (ex.: `ghostty-web`, `@solidjs/start` em `packages/app` e `packages/enterprise`). Se `bun turbo typecheck` falhar nesses pacotes, confirme com `git stash` se a falha já existe em HEAD limpo antes de assumir que é regressão sua — normalmente é limitação do ambiente, não do código. Nunca "corrija" isso removendo a dependência real do `package.json` — é só um workaround de sandbox, não uma correção de verdade (já aconteceu de um agente propor isso por engano).
- **O bloqueio do `@solidjs/start` é mais sério do que parece à primeira vista**: não é só uma falha de install isolada — três pacotes (`console-support`, `console-app`, `stats-app`) importam `@solidjs/start` de verdade no código-fonte (não é só uma entrada solta no `package.json`), então nenhum workaround de `package.json` resolve, e trocar o pin por uma versão real do npm (`2.0.5`, testado em 2026-09-15) também não resolve — a API difere da build de preview (`pkg.pr.new/@solidjs/start@dfb2020`) que está pinada. Na prática isso significa que **`bun typecheck`/`git push` local nunca vai passar neste sandbox para nenhuma branch**, não importa a versão do bun (mesmo instalando `bun@1.3.14` via npm registry, que funciona e resolve o gate de versão do hook — o bloqueio real é o `@solidjs/start`, não o bun). Pra mudanças de código real nesse cenário, a única rota é a API do GitHub (`create_or_update_file`/`push_files`), commitando o conteúdo final igual a alguém editando pela web UI — depois de qualquer push assim, confirme que o SHA do blob publicado bate exatamente com `git rev-parse <commit-local>:<arquivo>` antes de seguir em frente, pra garantir que nada foi transcrito errado na tentativa.
