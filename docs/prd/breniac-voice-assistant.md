# PRD — Breniac: Assistente de Voz Colaborador

**Status:** Rascunho / descoberta
**Branch:** `breniac` (criado a partir de `dev`)
**Autor:** Ronaldo + Claude (sessão de exploração)
**Última atualização:** 2026-08-20

## 1. Contexto

O opencode (fork) já tem um agente de chat completo — sessões, delegação de subagentes (Batuta), execução de tools, streaming de resposta token a token. O que falta é um modo de **interação por voz contínua**, onde o usuário liga um assistente (não grava um trecho e solta) e conversa com ele como conversaria com um colega: pede pra abrir um projeto, iniciar uma sessão, e a partir daí conduz o trabalho por voz, com o assistente executando e respondendo em tempo real.

Este documento registra a visão do produto e o que já foi levantado tecnicamente, para servir de base às próximas decisões de arquitetura e às issues que vão fatiar a implementação.

## 2. Visão do produto

**Breniac** é um colaborador de voz embutido no opencode. Não é um "ditado" (falar substitui digitar no composer) nem um "grava e manda" (like a voice memo). É um **modo ligado/desligado**: o usuário aciona um botão/atalho, o assistente fica "no ar" ouvindo, entende comandos tanto de **nível de aplicativo** (navegação, gestão de projetos/sessões) quanto de **nível de sessão** (pedir pra editar um arquivo, rodar um comando, delegar pra um worker Batuta), executa, e responde falando — sem que o usuário precise tocar em teclado ou mouse no meio do fluxo.

Exemplo do próprio pedido do usuário, que define o critério de aceite mais concreto que temos:

> "por favor abra o projeto X e vamos iniciar uma nova sessão"

Isso implica que Breniac não vive só dentro de uma sessão de chat — ele tem que enxergar e acionar o **app shell inteiro**: lista de projetos, criação de sessão, e (por extensão natural) o resto do que hoje só é alcançável clicando na UI.

**Breniac não é um assistente que concorda por padrão.** A segunda parte da visão de produto (2026-08-20) é tão central quanto a primeira: o objetivo não é só executar comandos, é ajudar o usuário a pensar melhor — entender suas dificuldades reais, apontar pontos cegos, questionar uma premissa quando fizer sentido, em vez de sempre validar o que foi dito. Essa postura é intencionalmente registrada num documento à parte (`soul.md`, seção 8.6) que evolui com o uso.

## 3. Não-objetivos (por agora)

- Não é objetivo desta fase suportar múltiplos idiomas simultâneos ou troca de idioma em tempo real (assume-se o idioma configurado no app).
- Não é objetivo ter wake-word ("Ei Breniac") nesta primeira versão — a ativação é manual (botão/atalho), não por voz.
- Não é objetivo rodar 100% local/offline — a v1 depende de um provedor de modelo com áudio (via Omniroute), não de STT/TTS embarcados.
- Não é objetivo cobrir mobile/web público — o foco é o app desktop (Electron).

## 4. Persona e caso de uso principal

**Persona:** o próprio Ronaldo, desenvolvendo com o opencode aberto, mãos ocupadas ou querendo manter o fluxo sem trocar de janela/foco de teclado — quer comandar o app com a voz enquanto olha código, revisa algo, ou está longe do teclado.

**Fluxo principal (happy path):**

1. Usuário aciona Breniac (botão fixo na UI, ou atalho de teclado global).
2. Um indicador visual mostra que o assistente está "ligado" e ouvindo.
3. Usuário fala: *"Abre o projeto opencode e inicia uma sessão nova."*
4. Breniac entende que isso é uma ação de app (não um prompt de sessão), executa: seleciona/abre o projeto, cria uma nova sessão.
5. Breniac confirma por voz: *"Pronto, sessão nova aberta no opencode."*
6. Usuário continua falando, agora dentro do contexto da sessão: *"Roda os testes e me diz se passou."*
7. Breniac interpreta isso como um prompt de sessão, envia pro fluxo normal de chat (que já dispara tools como `bash`), acompanha a execução, e quando a resposta streamada terminar, fala o resumo de volta.
8. Usuário desliga o Breniac (mesmo botão/atalho) quando quiser voltar ao silêncio.

## 5. Requisitos funcionais

### 5.1 Ativação
- **RF-01**: Um controle único (botão na UI + atalho de teclado global) liga/desliga o modo Breniac. Não é push-to-talk nem gravação de trecho — é um estado persistente "ligado" até ser desligado.
- **RF-02**: Indicador visual claro do estado (ocioso / ouvindo / processando / falando), visível mesmo se a janela não estiver em foco (ex.: badge no ícone da barra de tarefas, ou overlay).
- **RF-03**: Desligar o Breniac interrompe qualquer fala em andamento e para de escutar imediatamente.

### 5.2 Entendimento de comandos — dois níveis
- **RF-04 (nível de app)**: Breniac precisa reconhecer intenções que mapeiam pra **ações do app shell** — não são prompts de LLM dentro de uma sessão, são comandos diretos: abrir projeto, criar sessão, trocar de sessão, abrir Batuta, abrir configurações, etc.
- **RF-05 (nível de sessão)**: Quando o usuário está "dentro" de uma sessão (ou pede pra criar uma), a fala vira um prompt normal enviado pro fluxo de chat existente — reaproveita 100% o pipeline de streaming/tools que já existe.
- **RF-06**: Precisa haver alguma forma de decidir "isso é um comando de app ou um prompt de sessão?" — seja via um roteador leve (regras + fallback pro LLM), seja delegando essa decisão pro próprio modelo de voz com acesso às duas famílias de "tools".

### 5.3 Execução
- **RF-07**: Comandos de app executam de verdade (não é só transcrição bonita) — mesma ideia already validada com Batuta: sem mock, ação real.
- **RF-08**: Tools dentro de sessão (bash, edit, task, etc.) continuam executando exatamente como hoje — Breniac não reimplementa isso, só governa a entrada (voz→prompt) e a saída (resposta→voz) desse fluxo já existente.

### 5.4 Resposta falada
- **RF-09**: A resposta falada deve começar assim que houver conteúdo suficiente — não esperar a resposta inteira do LLM terminar pra só então começar a falar (mesmo princípio de streaming que já existe pro texto).
- **RF-10**: Se a resposta de texto for muito longa (ex.: um diff grande, uma lista extensa de arquivos), Breniac deve resumir por voz em vez de "ler" tudo — o texto completo continua disponível na UI normalmente.
- **RF-11**: O usuário deve poder interromper Breniac falando por cima (barge-in) — pelo menos na v2 (ver seção de fases); a v1 pode exigir esperar a resposta terminar antes do próximo comando.

### 5.5 Contexto e permissões
- **RF-12**: Breniac herda as mesmas permissões/regras de ferramentas já configuradas no opencode (ruleset de permissão por sessão/agente) — não é um caminho paralelo que ignora `permission.ask`/bloqueios existentes.
- **RF-13**: Ações destrutivas (deletar projeto, remover sessão, etc.) continuam exigindo confirmação — por voz ("tem certeza?") ou caindo pra UI, não executam direto só por terem sido faladas.

### 5.6 Memória
- **RF-16**: Por padrão, tudo que é dito numa sessão vinculada a um projeto é registrado na memória **daquele projeto** (seção 8.5). Memória global nunca é escrita silenciosamente — se o Breniac julgar algo relevante além do projeto atual, ele **pergunta ao usuário** antes de gravar lá.

### 5.7 Postura e identidade
- **RF-14**: Antes de gerar uma resposta, Breniac consulta o `soul.md` (seção 8.6) — não só a memória factual — pra decidir *como* responder, não só *o quê*. Isso inclui a possibilidade de questionar o pedido do usuário em vez de só executá-lo, quando fizer sentido.
- **RF-15**: O critério de sucesso de qualquer ajuste de postura registrado no `soul.md` precisa ser auditável em termos de utilidade real pro usuário (decisão melhor, problema resolvido), nunca em termos de "o usuário gostou/concordou" — ver salvaguarda contra bajulação na seção 8.6.

## 6. Requisitos não funcionais

- **RNF-01 (latência)**: o ciclo fala→ação/resposta precisa parecer conversacional — a v1 aceita alguns segundos de latência por turno (não é tempo real duplex), mas não pode ser "grava, espera 10s, ouve resposta" para comandos simples de app.
- **RNF-02 (custo)**: cada turno de voz consome tokens de um modelo de áudio (mais caro que texto puro) — precisa de visibilidade de custo/uso, e idealmente um jeito de desligar Breniac sem custo residual. Estimativa: com `openai/gpt-audio-mini` via Omniroute (`$0,60`/`$2,40` por 1M tokens in/out; conversão ~600 tokens/min de fala do usuário, ~1.200 tokens/min de fala do assistente), uma hora de conversa com turnos "limpos" (sem reenviar áudio antigo) custa **≈ $0,10**. O risco real é reenvio de histórico: `/v1/chat/completions` não é stateful como a Realtime API — sem controle de contexto, cada turno reenviaria a conversa acumulada em áudio, o que pode multiplicar esse custo várias vezes numa sessão longa com muitos turnos. Mitigação: ver seção 8.5 (arquitetura de memória) — só o turno atual vai como áudio; tudo antes disso vira texto ou memória resumida, nunca é reenviado como áudio.
- **RNF-03 (privacidade)**: áudio do microfone é sensível por natureza. Precisa ficar claro pro usuário quando está sendo capturado (RF-02) e o áudio deve ir só pro provedor configurado (Omniroute), sem gravação/persistência desnecessária local ou no servidor além do necessário pro turno atual.
- **RNF-04 (degradação graciosa)**: se o microfone não tiver permissão, ou o provedor de áudio falhar, o app não pode quebrar — cai pra aviso claro + sugestão de liberar permissão/checar conexão.
- **RNF-05 (acessibilidade)**: Breniac é um recurso adicional, não uma substituição — todo comando que ele executa precisa continuar sendo alcançável por teclado/mouse.

## 7. O que já sabemos tecnicamente (descoberta feita nesta sessão)

### 7.1 Transporte em tempo real do opencode hoje
- **SSE, não WebSocket**, é o canal de sessão/chat (`GET /event`, implementado em `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts` com `effect/unstable/encoding/Sse`). A resposta do LLM já é streamada token a token via `streamText()` da Vercel AI SDK (`packages/opencode/src/session/llm.ts`), normalizada em `session/llm/ai-sdk.ts` e publicada no mesmo barramento de eventos que alimenta o SSE.
- **WebSocket já existe no projeto, mas só pro terminal (PTY)** — `packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts` (upgrade HTTP→WS via `ctx.request.upgrade`), cliente em `packages/app/src/components/terminal.tsx`, com um `WebSocketTracker` pra fechar tudo no shutdown. **Esse é o padrão de referência caso a v2 do Breniac precise de duplex de áudio de verdade** (áudio binário nos dois sentidos, baixa latência) — não precisaríamos inventar a abstração de socket do zero.
- Não existe hoje nenhum suporte a áudio/voz no codebase (sem `getUserMedia`, `MediaRecorder`, STT/TTS) além de efeitos sonoros de notificação (`packages/tui/src/audio.ts`, `packages/app/src/utils/sound.ts`).

### 7.2 Permissão de microfone no Electron — bloqueada hoje
`packages/desktop/src/main/windows.ts:25-27` só permite as permissões `clipboard-sanitized-write` e `notifications`; qualquer outra (incluindo `"media"`, que cobre microfone) é negada por padrão pelo `setPermissionRequestHandler`/`setPermissionCheckHandler`. **Pré-requisito técnico**: adicionar `"media"` a `rendererPermissions`, e no macOS declarar `NSMicrophoneUsageDescription` no plist/entitlements (não existe hoje).

### 7.3 Modelo de voz — testado e funcional via Omniroute
- O provedor `omnrt` (Omniroute), já configurado no opencode, expõe **1565 modelos**, incluindo vários de áudio.
- **Testei de verdade** (fora do opencode, direto contra o gateway) o modelo `openrouter/openai/gpt-audio-mini` via `POST /v1/chat/completions` com `modalities: ["text","audio"]` e `audio: {voice, format: "pcm16"}`: retornou **200 OK**, streaming SSE, resposta em texto ("OK") + ~28.8 KB de áudio PCM16 real. **Esse é o modelo mais promissor pra Breniac**, porque faz entrada+saída de texto/áudio no mesmo modelo (não precisa orquestrar STT + LLM + TTS como três serviços separados).
  - Achado técnico importante: **o formato de áudio de saída tem que ser `pcm16`** — `mp3`, `opus`, `aac`, `flac`, `wav` todos retornaram `unsupported_value` da OpenAI.
  - Ainda não testei mandar **áudio de entrada** (só testei pedir áudio de saída) — próximo passo técnico antes de fechar a arquitetura.
- **STT isolado também funciona**: `openrouter/openai/whisper-1` via `POST /v1/audio/transcriptions` (multipart/form-data com arquivo de áudio) retornou 200 com transcrição real.
- **TTS isolado (Gemini) não está pronto**: `gemini-2.5-pro-preview-tts` retorna `"No credentials for provider: vertex"` — falta crédito/credencial de Vertex na conta Omniroute. `kc/openai/gpt-audio-mini` (rota kilocode, diferente da rota openrouter que funcionou) retorna `402 Add credits`.
- **Áudio nativo/realtime "puro" (Gemini Live API) não está mapeado no gateway**: `gemini/gemini-2.5-flash-native-audio-latest` retorna 404 — esse modelo precisa da API Live/bidiGenerateContent (websocket) do Google, não da rota REST padrão que o Omniroute está usando pra ele hoje.
- **Cuidado operacional**: as chamadas diretas ao gateway retornam `403` (Cloudflare, "error code 1010") se o `User-Agent` do cliente não parecer um navegador — qualquer implementação real (incluindo o backend do opencode) precisa mandar um `User-Agent` de navegador normal pras chamadas ao Omniroute não serem bloqueadas no edge.

### 7.4 Superfície de "ações de app" já existente pra reaproveitar
O opencode já tem um **command palette** com registro de comandos (`packages/app/src/context/command.tsx`, `CommandOption { id, title, description?, category?, keybind? }`), usado hoje por atalhos de teclado e pela paleta (Cmd+K). **Isso é o encaixe natural pras "ações de nível de app" do RF-04** — em vez de Breniac reimplementar "abrir projeto"/"nova sessão" do zero, ele pode expor (um subconjunto de, ou todos) os comandos já registrados na paleta como a lista de ações que o modelo de voz pode invocar (via tool-calling do próprio modelo de áudio, ou via um roteador de intenção mais simples). Precisa de investigação futura pra confirmar cobertura (nem todo comando de teclado hoje tem os parâmetros necessários pra ser chamado "as a function" — ex.: "abrir projeto X" precisa resolver X pra um projeto real, o comando de teclado hoje assume que o usuário já está navegando visualmente).

## 8. Arquitetura proposta (alto nível, sujeita a validação)

```
[Microfone do usuário]
        │  áudio (PCM16, streaming)
        ▼
[Camada de captura no app — precisa de permissão "media" liberada no Electron]
        │
        ▼
[Roteador de turno]  ── decide: comando de app OU prompt de sessão
        │                              │
        │ comando de app               │ prompt de sessão
        ▼                              ▼
[Executor de comandos]          [Fluxo de chat existente: SSE + streamText + tools]
        │                              │
        └──────────────┬───────────────┘
                        ▼
              [Resposta em texto, já streamada]
                        │
                        ▼
        [Modelo de voz gera/streama áudio de resposta]
                        │
                        ▼
              [Playback no app do usuário]
```

Duas variações possíveis pro "roteador de turno" e pro modelo em si — **ainda em aberto, precisa de decisão**:

- **Opção A — um único modelo de áudio faz tudo**: manda a fala pro `gpt-audio-mini` com um "tool" de app-commands e um "tool" de enviar-prompt-de-sessão disponíveis; o próprio modelo decide qual usar (tool-calling nativo, que ele já suporta pra texto). Mais simples de operar, mas acopla a lógica de roteamento ao comportamento do modelo de terceiro.
- **Opção B — STT separado + roteador próprio + LLM/TTS**: transcreve com Whisper, decide localmente (regras leves + fallback pro LLM de texto já usado na sessão) se é comando de app ou prompt, executa, e só gera áudio de saída (TTS) no final. Mais controle e mais barato por turno provavelmente, mas reintroduz a orquestração de 3 serviços que a Opção A evita.

## 8.5 Arquitetura de memória

Decisão de design (proposta pelo Ronaldo, 2026-08-20): **o áudio nunca é a forma de armazenar memória.** Ele existe só como transporte do turno atual (fala → texto na entrada, texto → fala na saída). Tudo que precisa persistir — dentro da sessão ou entre dias — vira texto. Isso resolve continuidade ("lembra do que conversamos ontem") e custo (seção RNF-02) ao mesmo tempo, com o mesmo mecanismo.

Duas camadas:

**Curto prazo (dentro da sessão de voz atual)**
O histórico da conversa em andamento fica como **transcrição em texto**, igual qualquer sessão de chat do opencode hoje. Só o turno mais recente (o que o usuário acabou de falar) vai como áudio de entrada pro modelo; a resposta sai em áudio, mas o que já foi dito antes nesse mesmo "ligar" do Breniac não é reenviado como áudio a cada novo turno — é contexto de texto normal, que já é ordens de magnitude mais barato.

**Longo prazo (entre sessões/dias)**
No fim de uma sessão de voz (ao desligar o Breniac, ou periodicamente), um passo de resumo escreve o que foi relevante num arquivo — ex.: `memory/2026-08-20.md` — com o que foi discutido/decidido/pendente. Quando o Breniac liga de novo (no mesmo dia ou depois), ele não recarrega a sessão anterior inteira: ele **lê o(s) arquivo(s) de memória recentes** (hoje + últimos N dias, ou um índice tipo `memory/INDEX.md` apontando pros arquivos relevantes) e usa isso como contexto inicial. "Lembra do que conversamos ontem" vira uma leitura de arquivo (`read` tool, que o Breniac já tem acesso via as tools normais do opencode), não reprocessamento de áudio nem de uma transcrição longa.

Isso é o mesmo padrão de memória índice+arquivos que já é usado nesta sessão de desenvolvimento (`MEMORY.md` + arquivos por tópico) — só que aplicado à continuidade de conversas de voz em vez de preferências de projeto. Não precisa de um mecanismo de armazenamento novo: é markdown normal, gerenciável pelas tools `read`/`write`/`edit` que o agente já usa pra tudo mais.

**Escopo e localização — decidido (2026-08-20):** os dois níveis existem em paralelo, não é "ou/ou":

- **Memória global** — `~/.local/share/opencode/breniac/memory/global/YYYY-MM-DD.md`. Continuidade pessoal que não é específica de um projeto: preferências do usuário, contexto de conversas que não tratam de um repo em particular.
- **Memória por projeto** — `~/.local/share/opencode/breniac/memory/projects/<chave-do-projeto>/YYYY-MM-DD.md`. Decisões e contexto específicos daquele repo, com a mesma lógica de chave-por-diretório que o resto do opencode já usa pra escopar dados por projeto (mesmo princípio de `Persist.serverWorkspace`/chaves por diretório já usado em outras partes do app, ver `packages/app/src/utils/persist.ts`).

Ambos ficam **fora do repositório versionado** — na pasta de dados locais do opencode (`~/.local/share/opencode/`, onde já vivem os bancos de sessão hoje: `opencode.db`, `opencode-*.db`), não dentro do projeto em si. Motivo: memória de conversa por voz é dado pessoal, não faz sentido entrar no histórico git de cada projeto nem ser exposta a quem clonar o repo.

**Ordem de carregamento**: ao ligar o Breniac, ele lê primeiro a memória global recente (quem é o usuário, preferências gerais), depois a memória do projeto atual (o que rolou especificamente ali) — geral primeiro, específico por cima, mesmo padrão de "config global + override por projeto/página" que outras partes do app já seguem (ex.: o design-system master+overrides, o sistema de permissões por sessão/agente).

**Critério global vs. projeto — decidido (2026-08-20):** a regra é simples e não delega a decisão pro julgamento silencioso do modelo:
1. Por padrão, tudo que foi dito numa sessão vinculada a um projeto vai pra memória **daquele projeto**.
2. Se o Breniac achar que algo é relevante além do projeto atual (relevante globalmente), ele **pergunta ao usuário** antes de gravar na memória global — nunca decide sozinho que algo "é sobre você" e promove pra global sem confirmação. Memória global só cresce com consentimento explícito, memória de projeto cresce por padrão.

**Gatilho e geração do resumo — decidido (2026-08-20):**
- **Gatilho**: o fim da sessão de voz (o usuário desliga o Breniac — RF-01) — não um timer periódico. É o único limite determinístico que já existe no fluxo, não precisa inventar um segundo.
- **Quem gera**: um único LLM de texto barato, chamado uma vez ao final, recebendo a **transcrição da sessão em texto** (nunca o áudio) e produzindo o resumo a persistir.
- **Critério do que persistir** (evita virar despejo de tudo que foi dito): decisões tomadas, fatos novos relevantes, pendências em aberto, e — o mais importante pro `soul.md` (seção 8.6) — **correções que o usuário fez no Breniac** durante a sessão. Conversa fiada e comandos que não mudaram nada ficam de fora.
- **Formato**: cada sessão vira uma **entrada anexada** ao arquivo do dia (com horário), nunca uma sobrescrita — várias sessões no mesmo dia acumulam no mesmo arquivo.

## 8.6 `soul.md` — identidade e postura do Breniac

Decisão de produto (Ronaldo, 2026-08-20): **o Breniac não é um assistente que concorda por padrão.** Ele existe pra ajudar o usuário a pensar melhor, entender suas dificuldades reais (técnicas e de raciocínio) e ajudá-lo a melhorar — o que às vezes significa discordar, questionar uma premissa, ou apontar um ponto cego, não só executar o que foi pedido. Isso é postura, não fato — por isso vive num documento separado da memória (seção 8.5), o `soul.md`.

**Diferença entre os dois tipos de arquivo:**

| | `memory/*.md` | `soul.md` |
|---|---|---|
| Conteúdo | O que aconteceu (fatos, decisões, contexto episódico) | Quem o Breniac é e como ele se relaciona com o usuário |
| Muda | Toda sessão relevante | Devagar, só quando há um aprendizado real sobre *como ajudar melhor* |
| Escopo | Global + por projeto (seção 8.5) | Global por padrão — é sobre a pessoa, não sobre o projeto |

**Conteúdo esperado do `soul.md`:**
- Diretrizes de postura: quando questionar em vez de concordar, quando o usuário precisa de apoio direto (executar sem fricção) vs. quando precisa ser desafiado a pensar antes de executar.
- Padrões observados nas dificuldades do usuário — não é uma lista de fatos ("o usuário trabalha no projeto X"), é entendimento acumulado ("o usuário tende a pular a etapa de validação quando está com pressa — vale perguntar antes de seguir direto").
- Sinais de que uma abordagem anterior não ajudou (o usuário corrigiu, ignorou uma sugestão, ficou frustrado) — pra não repetir o mesmo erro de condução.

**Mecanismo de auto-aperfeiçoamento — com guarda explícita contra virar bajulação.** O risco central desse recurso é que otimizar "o que funciona com o usuário" pode, sem querer, convergir pra "o que agrada o usuário" em vez de "o que realmente ajuda" — exatamente o comportamento que essa funcionalidade existe pra evitar. Duas salvaguardas necessárias:

1. **Objetivo de otimização explícito no próprio arquivo**: o critério de sucesso registrado não pode ser "o usuário ficou satisfeito", tem que ser algo como "o usuário chegou a uma decisão melhor/mais informada" ou "o problema foi resolvido de verdade" — precisa ser auditável, não um proxy de humor.
2. **Mudanças no arquivo são auditáveis e reversíveis**: nunca um auto-edit silencioso. Cada revisão do `soul.md` é um diff (git, já que o arquivo é markdown normal) com uma justificativa curta de por que mudou — o usuário pode ver o histórico e reverter uma "aprendizagem" que considerar errada, do mesmo jeito que reverteria qualquer commit.

**Gatilho e processo da auto-revisão — decidido (2026-08-20):**
- **Gatilho**: não é a cada sessão. Dispara quando (a) o mesmo padrão de dificuldade/correção aparece em **3 ou mais** resumos de memória recentes (o número é um ponto de partida, ajustável depois de uso real), ou (b) o usuário dá um sinal explícito de que uma abordagem do Breniac não ajudou. Um evento isolado não é suficiente — reduz ruído e evita reagir a exceções.
- **Quem escreve**: um passo **separado e "frio"**, rodado depois da sessão (nunca em tempo real, dentro da pressão da conversa por voz). Esse passo lê os **resumos de memória** recentes (não a sessão bruta) procurando o padrão que ativa o gatilho.
- **Nunca aplica direto**: o passo gera uma **proposta** de revisão com justificativa explícita citando o padrão observado (ex.: *"em 3 sessões o usuário corrigiu o Breniac por pular a validação antes de executar — proposta: perguntar antes de rodar ações irreversíveis sem teste cobrindo a mudança"*) e pede confirmação do usuário antes de gravar no `soul.md`. Isso torna a salvaguarda da seção anterior preventiva (revisão antes), não só corretiva (reverter depois).
- **Escopo**: fica global por ora — mesma decisão de manter simples já tomada na seção 8.5 antes de considerar uma variante por projeto no futuro.

## 9. Fases propostas

**Fase 1 — Turnos discretos, sem duplex real** (baixo risco, reaproveita quase tudo que já existe):
- Botão liga/desliga captura de áudio (sem VAD sofisticado — um turno = falar, uma pausa detectável simples, processa).
- STT (Whisper, já validado) → roteador simples (regras + fallback LLM) → executa comando de app OU manda como prompt de sessão.
- Resposta falada gerada ao final (TTS ou o próprio `gpt-audio-mini`), tocada no app.
- **Sem interrupção (barge-in)** — usuário espera Breniac terminar de falar antes do próximo comando.

**Fase 2 — Conversa mais fluida**:
- Streaming de resposta em áudio conforme os tokens de texto chegam (não espera a resposta inteira).
- Barge-in (interromper Breniac falando por cima).
- Possível migração pra um canal WebSocket dedicado (reaproveitando o padrão do PTY) se a latência round-trip por HTTP não for suficiente.

**Fase 3 (especulativa, fora de escopo por ora)**:
- Wake-word / ativação por voz.
- Múltiplas vozes/personas.
- Uso em mobile.

## 10. Riscos e questões em aberto

1. **Reconhecimento de "isso é comando de app ou prompt de sessão" é ambíguo por natureza.** Ex.: *"cria uma nova sessão pra revisar o PR 42"* já mistura os dois. Precisa de uma estratégia clara (provavelmente: deixar o próprio modelo decidir via tool-calling, com as duas famílias de ação expostas juntas, em vez de um classificador separado).
2. **Custo de áudio por token é bem mais alto que texto** — precisa de um teto de uso ou aviso, especialmente porque o modo é "ligado" (não por turno explícito) e pode ficar escutando silêncio/ruído de fundo sem querer.
3. **Permissão de microfone no Electron ainda não existe** — é um pré-requisito de engenharia antes de qualquer protótipo rodar dentro do app (funciona no browser hoje via `preview_start`, mas não no app empacotado).
4. **TTS "de qualidade" ainda não está liberado na conta Omniroute** (falta crédito/credencial Vertex) — a Fase 1 pode depender de resolver isso, ou usar `gpt-audio-mini` (que já funciona) como fonte tanto de texto quanto de áudio de saída, evitando depender do TTS separado do Gemini.
5. **Ainda não testamos áudio de entrada** (mandar a fala do usuário pro modelo) — só testamos pedir áudio de saída. Isso precisa ser validado antes de fechar a Opção A da arquitetura.
6. **Cobertura do command palette pra virar "tools" de voz** não foi mapeada em detalhe — alguns comandos podem precisar de parâmetros que hoje só existem implicitamente (contexto visual da UI), não como argumentos explícitos.
7. **`soul.md` auto-aperfeiçoável pode derivar pra bajulação se o critério de sucesso não for bem definido** (ver salvaguardas na seção 8.6) — é o risco mais delicado desse PRD, porque o próprio objetivo do recurso ("Breniac não deve só concordar") é o que uma otimização mal desenhada tende a corroer primeiro. Precisa de revisão cuidadosa antes de implementar o mecanismo de auto-revisão, não só do conteúdo do arquivo.

## 11. Métricas de sucesso (propostas)

- Comando de app simples ("abre o projeto X e inicia uma sessão") executa corretamente em ≥95% das tentativas em teste manual.
- Latência percebida (fim da fala do usuário → início da resposta falada) abaixo de ~3s pra comandos de app na Fase 1.
- Zero execução de ação destrutiva sem confirmação, em qualquer teste.
- Uso do modo Breniac não quebra nenhum fluxo existente de teclado/mouse (regressão zero na UI atual).

## 11.5 Panorama de modelos self-hosted (pesquisa em andamento — 2026-08-20)

Levantamento no Hugging Face de modelos de voz auto-hospedáveis que se encaixam no objetivo de "conversa live + controle do app" (não só bate-papo). Ordenado por aderência ao caso de uso do Breniac, não por popularidade:

### 🥇 NVIDIA NemotronLabs-VoiceChat-11B
- **Único modelo aberto encontrado com canal de tool-calling nativo dentro de um fluxo full-duplex** — exatamente o formato do RF-04/RF-05 (comando de app vs. prompt de sessão), só que embutido no próprio modelo em vez de eu ter que construir o roteador.
- Arquitetura: Fast Conformer (encoder de fala) + Nemotron Nano v2 9B (LLM) + decoder/codec de TTS da NVIDIA + canal de saída de tool-call separado.
- Formato de tool-call: `<TOOLCALL>[{"name": "...", "arguments": {...}}]</TOOLCALL>`, resposta em `<TOOL_RESPONSE>[...]</TOOL_RESPONSE>` — dá pra mapear direto pros comandos do command palette (seção 7.4).
- Toca uma mensagem "on-hold" customizável enquanto a tool executa — resolve o RF-09/RF-10 (não travar em silêncio esperando a ação terminar) de graça.
- Latência de turno: ~450ms.
- **Custo de hardware é o entrave**: requer GPU classe A100/H100/H200/B100/B200 ou RTX-6000 — não roda em GPU de consumidor. Serve via vLLM, container de inferência da própria NVIDIA com **interface WebSocket** (bate exatamente com o padrão de referência que já identificamos no PTY do opencode).
- Licença: OpenMDW 1.1 (não é Apache/MIT — precisa revisar termos antes de decidir).
- Foco em inglês (baseado no `Nemotron-Speech-Streaming-En-0.6b`) — impacto direto se quisermos comandos em português.

### 🥈 Qwen3-Omni-30B-A3B-Instruct
- Thinker-Talker (mesma família da seção 8), mas com **tool-calling documentado via "audio function call cookbook"** e suporte nativo a contexto longo/RAG — forte pro caso de "entender completamente o fork" que você descreveu.
- Licença **Apache 2.0** (mais permissiva que a NVIDIA).
- MoE: 35B total, ~3B ativos por token — mais leve de rodar que um denso equivalente, mas os requisitos de VRAM documentados (78-107GB) são pra vídeo; pra áudio-only não está claro, precisa medir.
- Não é full-duplex "de verdade" — é near-duplex, turn-based com resposta rápida, não conversa sobreposta.
- Roda via vLLM (recomendado) ou Transformers.

### 🥉 Moshi (Kyutai) / PersonaPlex (NVIDIA)
- O full-duplex mais leve pra rodar localmente (~7B, ~160-200ms, codec Mimi) — melhor "sensação de conversa" das três opções.
- Mas **não é construído pra tool-calling/comandos estruturados** — é otimizado pra diálogo natural, não pra "abra o projeto X". Ficaria como opção de fallback se priorizarmos fluidez de conversa sobre controle de app, o que não é o objetivo principal do Breniac.

### Como isso se compara com a Opção A/B da seção 8 (Omniroute/gpt-audio-mini)
A cascata via Omniroute continua sendo a opção **de menor esforço de infraestrutura** (zero GPU local, já validada funcionando). O NemotronLabs-VoiceChat-11B é a opção que **mais se alinha à visão de produto** (full-duplex + tool-calling nativo), mas troca "zero infra" por "precisa de GPU de datacenter" — decisão de arquitetura real a ser tomada, não só técnica: depende se faz sentido pra você manter um servidor de inferência rodando localmente/em nuvem só pro Breniac, versus pagar por chamada via Omniroute.

**Ainda não decidido, fica registrado como pauta aberta** — nenhuma dessas opções foi testada de verdade ainda (diferente do `gpt-audio-mini`, que já validamos rodando).

## 12. Próximos passos

1. Validar o envio de **áudio de entrada** pro `gpt-audio-mini` via Omniroute (fechar a dúvida da seção 10.5).
2. Decidir Opção A vs Opção B da arquitetura (seção 8) com base nesse teste.
3. Mapear quais comandos do command palette (`context/command.tsx`) fazem sentido como "ações de app" pra Breniac, e quais precisam de uma versão nova com parâmetros explícitos.
4. Liberar permissão de microfone no Electron (`packages/desktop/src/main/windows.ts`) atrás de uma flag/feature gate, pra não expor isso a todos os usuários do fork prematuramente.
5. Fatiar em issues (seguindo o mesmo padrão usado pro epic Batuta: slices verticais pequenos, `Blocked by` entre eles) assim que a arquitetura da seção 8 estiver decidida.
6. Testar de verdade (não só ler a model card) o NemotronLabs-VoiceChat-11B e o Qwen3-Omni-30B-A3B — o primeiro pra confirmar se o formato `<TOOLCALL>` mapeia bem pros comandos do command palette, o segundo pra medir VRAM real em cenário áudio-only (a documentação só cobre vídeo).
7. Prototipar o ciclo mínimo da seção 8.5 (já decidido): sessão de voz → resumo em texto ao desligar → arquivo `memory/YYYY-MM-DD.md` → próxima sessão lê e usa como contexto inicial.
8. Implementar o passo "frio" de auto-revisão do `soul.md` (seção 8.6, já decidido) — o gatilho por padrão repetido/sinal explícito, a proposta com justificativa, e o fluxo de confirmação antes de gravar. Testar primeiro com dados sintéticos/simulados antes de deixar rodar sobre sessões reais.
