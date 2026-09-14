# ADR 0003: EnvironmentRegistry como armazenamento local do cliente (Desktop / CLI / Mobile)

## Status
Aceito (2026-09-13)

## Contexto
O OpenCode precisa permitir que clientes (Desktop, CLI, Mobile) salvem e reutilizem múltiplos ambientes remotos (VPS, servidores dedicados, instâncias cloud) sem necessidade de re-digitar URL, tokens ou credenciais de pareamento a cada sessão (issue #78).

A questão técnica levantada é: onde o registro de ambientes deve residir? Deve haver um endpoint HTTP no servidor para gerenciar ambientes remotos ou o registro deve viver localmente no cliente?

## Decisão
O registro de ambientes (`EnvironmentRegistry`) vive **exclusivamente no lado do cliente**:
1. **CLI**: Armazenado em `Global.Path.config/environments.json` (ex: `~/.config/opencode/environments.json` ou `%APPDATA%/opencode/environments.json`).
2. **Desktop**: Armazenado via `electron-store` / configuração do app, compatível com a lista de servidores em `ServerConnection`.
3. **Mobile**: Armazenado no armazenamento local do dispositivo (AsyncStorage / SecureStore).

Cada daemon/servidor `opencode` é um processo local ao host onde está executando e não tem necessidade de conhecer outros servidores remotos. É o cliente que precisa selecionar, alternar e conectar a múltiplos ambientes.

O schema canônico `Environment.Info` e `Environment.ID` reside em `@opencode-ai/schema/environment`, fornecendo interoperabilidade de tipos entre clientes e ferramentas de automação.

## Consequências
- Não é necessário hospedar um "meta-servidor" ou endpoint central para que clientes operem múltiplos servidores remotos.
- Cada cliente tem isolamento e controle sobre os servidores que possui salvos.
- Ambientes cadastrados pelo CLI e Desktop persistem entre reinicializações de máquina sem necessidade de re-pareamento.
- Scripts e ferramentas de automação podem manipular ambientes locais via comandos `opencode environment add`, `list`, `rm`.
