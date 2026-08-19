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
<p align="center">
  <a href="https://github.com/alltomatos/opencode/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/alltomatos/opencode?style=flat-square" /></a>
  <a href="https://github.com/alltomatos/opencode/actions"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/alltomatos/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/alltomatos/opencode)

---

Este é um fork pessoal do [OpenCode](https://github.com/anomalyco/opencode), mantido por [Alltomatos](https://github.com/alltomatos), com o foco no app desktop para Windows e ajustes de UI/UX específicos deste fork (sidebar de projetos, terminal e browser embutidos no cabeçalho da sessão, seed de skills padrão, entre outros — veja o [changelog](./changelog.json) e as [releases](https://github.com/alltomatos/opencode/releases) para o histórico completo).

### App Desktop

Baixe o instalador direto na [página de releases](https://github.com/alltomatos/opencode/releases/latest).

| Plataforma | Download                       |
| ---------- | ------------------------------- |
| Windows    | `opencode-desktop-win-x64.exe`  |

Instalação via PowerShell (sempre baixa a última versão publicada):

```powershell
irm https://raw.githubusercontent.com/alltomatos/opencode/dev/install.ps1 | iex
```

O app verifica atualizações automaticamente contra este repositório (`alltomatos/opencode`), não contra o projeto original.

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
