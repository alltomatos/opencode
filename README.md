<p align="center">
  <a href="https://github.com/alltomatos/opencode">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">OpenCode by Alltomatos — a fork of the open source AI coding agent.</p>
<p align="center">[OpenCode by Alltomatos — a fork of the open source AI coding agent.](https://chat.whatsapp.com/DOLzfQ4aPZ12R7ZRbLabNh)</p>

<p align="center">
  <a href="https://github.com/alltomatos/opencode/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/alltomatos/opencode?style=flat-square" /></a>
  <a href="https://github.com/alltomatos/opencode/actions"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/alltomatos/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/alltomatos/opencode)

---

Este é um fork pessoal do [OpenCode](https://github.com/anomalyco/opencode), mantido por [Alltomatos](https://github.com/alltomatos), com o foco no app desktop para Windows e ajustes de UI/UX específicos deste fork (sidebar de projetos, terminal e browser embutidos no cabeçalho da sessão, seed de skills padrão, entre outros — veja o [changelog](./changelog.json) e as [releases](https://github.com/alltomatos/opencode/releases) para o histórico completo).

### Branches

Este fork trabalha com duas branches:

- **`prod`** — branch de produção. Só ela gera releases publicados (o app instalado e o auto-updater apontam pra cá). É pra onde `dev` é promovida quando um lote de mudanças está maduro.
- **`dev`** — branch de desenvolvimento. Todo o trabalho novo (features, correções, UI/UX) acontece aqui primeiro, roda em modo dev localmente pra validar, e só depois é promovida pra `prod`.

### App Desktop (produção)

Baixe o instalador direto na [página de releases](https://github.com/alltomatos/opencode/releases/latest) — sempre gerado a partir da branch `prod`.

| Plataforma       | Download                                  |
| ---------------- | ------------------------------------------ |
| Windows          | `opencode-desktop-win-x64.exe` (instalador NSIS) |
| macOS (Intel/ARM) | `opencode-desktop-mac-x64.dmg` / `opencode-desktop-mac-arm64.dmg` |
| Linux (Debian/Ubuntu) | `opencode-desktop-linux-x64.deb`      |
| Linux (Fedora/RHEL)   | `opencode-desktop-linux-x64.rpm`      |
| Linux (universal)     | `opencode-desktop-linux-x64.AppImage` |

Instalação via PowerShell no Windows (sempre baixa a última versão publicada):

```powershell
irm https://raw.githubusercontent.com/alltomatos/opencode/prod/install.ps1 | iex
```

No macOS e Linux, baixe o instalador correspondente direto da [página de releases](https://github.com/alltomatos/opencode/releases/latest) e instale manualmente (`.dmg`, `dpkg -i *.deb`, `rpm -i *.rpm`, ou dê permissão de execução no `.AppImage`).

> **Nota (macOS):** os builds de Mac não são assinados/notarizados por este fork (não temos uma conta Apple Developer configurada). Na primeira abertura o Gatekeeper vai avisar que o app "não pode ser verificado" — clique com o botão direito no app → **Abrir** para liberar manualmente.

O app verifica atualizações automaticamente contra este repositório (`alltomatos/opencode`), não contra o projeto original.

### Rodando em desenvolvimento

Pra validar mudanças antes de promover `dev` pra `prod`, rode o app desktop localmente a partir da branch `dev`:

```bash
git clone https://github.com/alltomatos/opencode.git
cd opencode
git checkout dev
bun install
cd packages/desktop
bun run dev
```

Isso abre o Electron em modo desenvolvimento (canal `dev`, auto-update desativado, ícone de dev). Pra buildar um instalador local sem publicar:

```bash
cd packages/desktop
OPENCODE_CHANNEL=prod bun run build
bun run package:win     # Windows (feito manualmente nesta máquina)
bun run package:mac     # macOS — precisa rodar num Mac
bun run package:linux   # Linux — precisa de dpkg/rpm/fpm disponíveis
```

O instalador gerado fica em `packages/desktop/dist/`.

**Publicação real é automática**: assim que a branch `prod` recebe um push (a promoção `dev` → `prod`), o workflow [`release-desktop.yml`](./.github/workflows/release-desktop.yml) dispara sozinho e builda Windows/macOS/Linux em paralelo (`windows-latest`/`macos-latest`/`ubuntu-latest`), publicando os três num único release do GitHub com a versão que estiver em `packages/desktop/package.json` no momento do push. Não precisa mais buildar nada manualmente nesta máquina — só bumpar a versão, commitar, e promover. Pra reexecutar manualmente (ex: retry de uma plataforma que falhou), use `gh workflow run release-desktop.yml`.

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents) in the original project's docs.

### Documentation

A documentação de configuração geral segue a do projeto original: [opencode.ai/docs](https://opencode.ai/docs). Diferenças específicas deste fork (sidebar de projetos, seed de skills, canal de atualização, etc.) não estão documentadas lá — consulte o [changelog](./changelog.json) deste repositório.

---

## Créditos

Este fork existe graças ao trabalho da equipe original do **[OpenCode](https://github.com/anomalyco/opencode)** (anomalyco). Todo o núcleo do produto — o agente de codificação, a TUI, o protocolo, o SDK — vem do projeto original; este fork adiciona e ajusta principalmente a camada do app desktop.

- Projeto original: [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
- Site oficial: [opencode.ai](https://opencode.ai)
- Discord oficial: [opencode.ai/discord](https://opencode.ai/discord)

Se você não está procurando especificamente por este fork, use o [projeto original](https://github.com/anomalyco/opencode) — ele recebe atualizações com muito mais frequência e é o software com suporte oficial.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with them in any way.
