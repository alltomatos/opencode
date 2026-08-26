# ADR 0003: `Credential.Service` passa a ser injetado em todo Native Provider Plugin

## Status
Aceito (2026-08-26)

## Contexto
A issue #90 (descoberta dinâmica de `/v1/models` do OmniRoute) precisa que o plugin nativo faça uma chamada HTTP autenticada usando a API key que o usuário salvou via `auth.set`. O contexto (`ctx`) que um Native Provider Plugin recebe hoje (`packages/core/src/plugin/internal.ts`, união `Requirements`) não dá acesso ao valor resolvido de uma credencial — só ao `Integration.Service`, que devolve no máximo um ponteiro (`{type:"credential", id, label}`), nunca o segredo em si. `Credential.Service` (que tem o valor) não estava na lista de serviços injetados em nenhum plugin nativo.

Isso nunca tinha sido um problema porque nenhum outro Native Provider Plugin faz chamada de rede própria usando uma credencial de conexão salva — os que precisam de OAuth (ex: GitHub Copilot) usam um módulo dedicado fora do sandbox de plugin, com seu próprio acesso a `auth.json`.

## Decisão
Injetar `Credential.Service` na união `Requirements` de `packages/core/src/plugin/internal.ts`, disponível para **todo** Native Provider Plugin — não um caso especial só para OmniRoute. Isso é consistente com o padrão já usado por `Config.Service`, `Integration.Service`, etc.: um serviço central, disponível para qualquer plugin que precise dele, em vez de módulos dedicados fora do sandbox por provider.

## Alternativas consideradas
- **Módulo dedicado fora do sandbox (padrão do GitHub Copilot)**: não muda a superfície genérica de plugin, mas replica o mesmo padrão especial-caseado que a decisão de ir com Native Provider Plugin (ADR 0002) já tentava evitar — cada provider dinâmico futuro reinventaria seu próprio acesso a credencial em vez de usar o mecanismo comum.

## Consequências
- Qualquer Native Provider Plugin (não só OmniRoute) passa a poder ler o valor resolvido de uma credencial salva — aumenta a superfície de acesso a segredos dentro do processo do fork. Como plugins nativos já são código de primeira parte (não pacotes de terceiros carregados dinamicamente — esses usam o contrato v1 separado em `packages/plugin`), o risco é equivalente ao que qualquer outro módulo interno do fork já tem.
- `Credential.Service` depende de `Database.Service` — `packages/core/src/plugin/internal.ts`'s `node` (LayerNode) precisa declarar `Credential.node` como dependência adicional no grafo de composição.
