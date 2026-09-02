import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigBatutaV1 } from "@opencode-ai/core/v1/config/batuta"
import { ConfigBatutaSkillsV1 } from "@opencode-ai/core/v1/config/batuta-skills"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { Worktree } from "@/worktree"
import { Git } from "@/git"
import { ExternalAgent } from "@/external-agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Context, Effect, Layer, Schema } from "effect"
import * as fs from "fs/promises"
import * as path from "path"

const toPosix = (value: string) => value.split(path.sep).join("/")
const PIPELINE_DIR = (directory: string, id: string) => path.join(directory, ".batuta", id)
const HANDOFF_PATH = (directory: string, id: string) => path.join(PIPELINE_DIR(directory, id), "handoff.md")
export const PIPELINE_PATH = (directory: string, id: string) => path.join(PIPELINE_DIR(directory, id), "pipeline.md")
/** Relative, forward-slash path for the activity's handoff file — used in instructions sent to the LLM (never mix OS path separators into a prompt). */
const HANDOFF_RELATIVE = (id: string) => toPosix(path.join(".batuta", id, "handoff.md"))
const PIPELINE_RELATIVE = (id: string) => toPosix(path.join(".batuta", id, "pipeline.md"))
// One shared file per project (not per activity) — the Architect reads it
// before deciding a new activity's flow, reuses/extends it if it already
// fits, and creates it the first time. The user can also edit it directly at
// any point, and the Orchestrator re-reads it before dispatching.
const PIPELINE_DEFINITION_RELATIVE = "docs/batuta-pipeline.md"
const PIPELINE_DEFINITION_PATH = (directory: string) => path.join(directory, ...PIPELINE_DEFINITION_RELATIVE.split("/"))

function architectInstructions(activity: ConfigBatutaV1.Activity) {
  const skills = ConfigBatutaSkillsV1.SKILLS.map((skill) => `- ${skill.slug}: ${skill.description}`).join("\n")
  return `Você é o Arquiteto responsável por preparar a atividade "${activity.name}" antes que o time de orquestração comece a trabalhar.

Objetivo da atividade:
${activity.goal}

Sua tarefa:
1. Estude o projeto (código, docs existentes) em relação a esse objetivo.
2. Crie ou edite os documentos necessários (ex: PRD, DER) no repositório, refletindo o entendimento atual.
3. Use a skill /grill-me para validar/refinar seu entendimento antes de finalizar, caso haja ambiguidade.
4. Fatie a atividade em issues discretas e acionáveis.
5. Defina o fluxo (pipeline) de desenvolvimento desta atividade — quais fases ela passa (ex: Planejamento, Desenvolvimento, Testes, Qualidade, Entrega, ou outras que fizerem mais sentido pro tipo de trabalho) e quais das skills fixas abaixo pertencem a cada fase:
${skills}
   - Verifique primeiro se já existe o arquivo "${PIPELINE_DEFINITION_RELATIVE}" (relativo à raiz do projeto). Esse arquivo é compartilhado entre todas as atividades deste projeto — se já existir, leia-o e reaproveite/ajuste o fluxo definido lá em vez de recriar do zero.
   - Se não existir, crie-o agora com esse formato (um heading "##" por fase, seguido da lista de slugs de skill daquela fase):
     ## Planejamento
     - to-prd
     - to-issues
     (fases e skills reais dependem do que você decidir ser apropriado — este é só um exemplo de formato)
   - O usuário pode editar esse arquivo livremente a qualquer momento; sempre releia-o antes de decidir, nunca assuma que o conteúdo é o que você escreveu da última vez.
6. Finalize usando a skill /handoff: ela deve empacotar os documentos relevantes e a lista de issues, e escrever esse pacote no arquivo "${HANDOFF_RELATIVE(activity.id)}" (relativo à raiz do projeto), em markdown, uma issue por item de lista, pois é assim que o orquestrador saberá que pode assumir o trabalho.`
}

function orchestratorInstructions(activity: ConfigBatutaV1.Activity, handoff: string) {
  const skills = ConfigBatutaSkillsV1.SKILLS.map((skill) => `- ${skill.slug}: ${skill.description}`).join("\n")
  const workers = activity.workers.length
    ? activity.workers
        .map((worker) =>
          worker.kind === "external"
            ? `- ${worker.label} (external: ${worker.command})`
            : `- ${worker.label} (model: ${worker.model})`,
        )
        .join("\n")
    : "(nenhum worker pré-configurado)"
  return `Você é o Orquestrador da atividade "${activity.name}". O Arquiteto concluiu a preparação e entregou o seguinte pacote (documentos + issues):

${handoff}

Workers pré-configurados disponíveis (delegue por label via a tool task):
${workers}

Além disso, você pode delegar qualquer issue a um subagente especializado passando subagent_type igual ao slug de uma das skills fixas abaixo:
${skills}

Antes de despachar, leia o arquivo "${PIPELINE_DEFINITION_RELATIVE}" (relativo à raiz do projeto) — o Arquiteto definiu ali as fases do fluxo desta atividade e quais skills pertencem a cada uma. Siga esse fluxo ao decidir a ordem de delegação. O usuário pode ter editado esse arquivo depois que o Arquiteto o escreveu (inclusive enquanto você já está despachando) — releia-o periodicamente e ajuste a sequência se ele tiver mudado, em vez de confiar só na leitura inicial.

Decida a sequência de delegação de acordo com cada issue, seguindo a natureza do problema, sem esperar aprovação do usuário para prosseguir.

Importante sobre isolamento e merge:
- Cada worker sempre trabalha isolado em seu próprio git worktree — isso é obrigatório, não uma opção. O worker nunca escreve direto no checkout principal.
- Quando um worker termina uma issue, ele devolve o resultado a você (via a tool task). Você é quem decide o que acontece em seguida: revisar o diff do worker (você tem acesso às ferramentas de diff/arquivo), aceitar e mesclar o trabalho ao checkout principal, pedir ajustes ao mesmo worker, acionar outro worker/skill para uma etapa seguinte, ou devolver a issue para mais uma rodada.
- Nunca mescle um resultado sem revisar o diff primeiro.

A cada delegação, atualize o arquivo "${PIPELINE_RELATIVE(activity.id)}" (relativo à raiz do projeto) com uma lista markdown no formato:
- [status] skill-slug — descrição da etapa — motivo

Crie o arquivo se ele não existir, e mantenha-o atualizado conforme cada issue é despachada, revisada e mesclada.`
}

function workerList(activity: ConfigBatutaV1.Activity) {
  return activity.workers.length
    ? activity.workers
        .map((worker) =>
          worker.kind === "external"
            ? `- ${worker.label} (external: ${worker.command})`
            : `- ${worker.label} (model: ${worker.model})`,
        )
        .join("\n")
    : "(nenhum worker pré-configurado)"
}

// Fed to an external-CLI orchestrator's PTY as its first message. Unlike the
// internal orchestrator, it has no task tool and never ran the Architect/
// handoff flow — it delegates over plain HTTP instead (see the "delegate"
// route in the batuta HTTP group), and starts straight from the goal.
function externalOrchestratorInstructions(activity: ConfigBatutaV1.Activity, serverURL: string) {
  return `Você é o Orquestrador (CLI externo) da atividade "${activity.name}".

Objetivo:
${activity.goal}

Workers disponíveis (delegue por label):
${workerList(activity)}

Você não tem uma tool "task" neste ambiente — delegue fazendo uma chamada HTTP síncrona para cada tarefa:

POST ${serverURL}/batuta/${activity.id}/delegate
Content-Type: application/json

{"label": "<label do worker>", "prompt": "<a tarefa para esse worker>"}

A resposta é {"output": "<resultado do worker>"}. A chamada só retorna depois que o worker termina — não precisa fazer polling.

Cada worker sempre trabalha isolado em seu próprio git worktree. Revise o resultado de cada delegação antes de decidir a próxima (aceitar, pedir ajuste, ou seguir para a próxima etapa). Decida a sequência sozinho, sem esperar aprovação do usuário para prosseguir.`
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Batuta.NotFoundError", {
  id: Schema.String,
}) {}

export class HandoffNotFoundError extends Schema.TaggedErrorClass<HandoffNotFoundError>()(
  "Batuta.HandoffNotFoundError",
  { id: Schema.String },
) {}

export class WorkerNotFoundError extends Schema.TaggedErrorClass<WorkerNotFoundError>()(
  "Batuta.WorkerNotFoundError",
  { id: Schema.String, label: Schema.String },
) {}

export type DelegateResult =
  | { readonly kind: "external"; readonly output: string }
  | {
      readonly kind: "internal"
      readonly sessionID: SessionID
      readonly model: { readonly providerID: ProviderV2.ID; readonly modelID: ModelV2.ID }
      readonly prompt: string
    }

export function parseModel(model: string) {
  const index = model.indexOf("/")
  if (index === -1) return { modelID: ModelV2.ID.make(model), providerID: ProviderV2.ID.make(model) }
  return { providerID: ProviderV2.ID.make(model.slice(0, index)), modelID: ModelV2.ID.make(model.slice(index + 1)) }
}

export interface RunningActivity {
  activity: ConfigBatutaV1.Activity
  /** worker id -> git worktree directory, only populated when the activity uses worktrees */
  workerDirectories: Map<string, string>
}

export interface Interface {
  readonly list: () => Effect.Effect<ConfigBatutaV1.Activity[]>
  readonly add: (activity: ConfigBatutaV1.Activity) => Effect.Effect<ConfigBatutaV1.Activity>
  readonly remove: (id: string) => Effect.Effect<void>
  /** Creates the dedicated Architect session and returns its ID plus the instructions the caller (HTTP handler) should send as the first prompt — Batuta.Service can't depend on SessionPrompt.Service itself (ToolRegistry, a dep of SessionPrompt, already depends on Batuta). When orchestratorKind is "external", it spawns the CLI directly instead (no session, no Architect/handoff), returns `instructions: ""` as a sentinel the caller should NOT send as a prompt, and `sessionID` is the activity id, not a real session. `serverURL` is required for that case — the base URL the external CLI should call back into for /batuta/:id/delegate. */
  readonly start: (
    id: string,
    opts?: { serverURL?: string },
  ) => Effect.Effect<{ sessionID: SessionID; instructions: string }, NotFoundError, never>
  /** Polled by the frontend while an activity is in the "architecting" phase: checks for the Architect's handoff file, and if found, moves the activity to "ready" and returns the handoff content for the user to review before dispatching. */
  readonly checkHandoff: (
    id: string,
  ) => Effect.Effect<{ activity: ConfigBatutaV1.Activity; handoff?: string }, NotFoundError>
  /** Called when the user clicks "Iniciar atividade" on a "ready" activity: creates the Orchestrator session from the reviewed handoff and returns the instructions the caller should send as its first prompt. */
  readonly dispatch: (
    id: string,
  ) => Effect.Effect<{ sessionID: SessionID; instructions: string }, NotFoundError | HandoffNotFoundError>
  /** Looked up by task.ts: is `label` a worker of a Batuta activity the given session (or one of its ancestors) is running? */
  readonly resolveWorker: (
    orchestratorSessionID: string,
    label: string,
  ) => Effect.Effect<{ worker: ConfigBatutaV1.Worker; directory?: string } | undefined>
  /** Delegation entry point for an external-CLI orchestrator (POST /batuta/:id/delegate) — it has no
   * task tool, so it calls this over HTTP instead. Resolves the worker by label against the activity's
   * running external-orchestrator registration, then either runs it directly (external worker: spawn a
   * PTY, send the prompt, wait for it to go idle, return the output) or hands back enough info for the
   * HTTP handler to run it (internal worker: Batuta.Service can't depend on SessionPrompt.Service, same
   * reason as `start`/`dispatch`). */
  readonly delegate: (
    activityID: string,
    label: string,
    prompt: string,
  ) => Effect.Effect<DelegateResult, NotFoundError | WorkerNotFoundError, never>
  /** Reads docs/batuta-pipeline.md for the activity's project directory (shared across all activities in that project) — used by the editor UI. */
  readonly readPipelineDefinition: (id: string) => Effect.Effect<string | undefined, NotFoundError>
  /** Overwrites docs/batuta-pipeline.md — the user can edit the flow at any point, including while the Orchestrator is already dispatching. */
  readonly writePipelineDefinition: (id: string, content: string) => Effect.Effect<void, NotFoundError>
  /** Creates a session scoped to editing docs/batuta-pipeline.md via chat — given a parentID so it's
   * a child session (hidden from the normal session list, same as any subagent) and a permission
   * ruleset that only allows reading/writing that one file. */
  readonly startPipelineChat: (id: string) => Effect.Effect<{ sessionID: SessionID; instructions: string }, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Batuta") {}

const layer: Layer.Layer<
  Service,
  never,
  Config.Service | Session.Service | Worktree.Service | Git.Service | ExternalAgent.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfgSvc = yield* Config.Service
    const sessions = yield* Session.Service
    const worktree = yield* Worktree.Service
    const git = yield* Git.Service
    const externalAgent = yield* ExternalAgent.Service

    // Orchestrator sessionID -> running activity state. Session IDs are
    // globally unique, so this doesn't need per-project isolation.
    const running = new Map<string, RunningActivity>()
    // Worker worktrees created at start(), waiting for checkHandoff() to
    // create the orchestrator session they'll be attached to.
    const pendingWorkerDirectories = new Map<string, Map<string, string>>()
    // Activity id -> running state, for activities whose orchestrator is an
    // external CLI (no opencode session to key `running` off of).
    const runningExternal = new Map<string, RunningActivity>()

    // In-memory overlay on top of disk config. Config.Service.updateGlobal
    // only invalidates its own global cache, not the per-instance merged
    // view Config.Service.get() reads — so a freshly added/removed activity
    // wouldn't be visible via get() alone until some later reload. Mirrors
    // the same overlay pattern used by MCP.Service.add for the same reason.
    const overlay = new Map<string, ConfigBatutaV1.Activity | undefined>()

    const list = Effect.fn("Batuta.list")(function* () {
      const cfg = yield* cfgSvc.get()
      const merged = new Map<string, ConfigBatutaV1.Activity>(Object.entries(cfg.batuta ?? {}))
      for (const [id, activity] of overlay) {
        if (activity) merged.set(id, activity)
        else merged.delete(id)
      }
      return Array.from(merged.values())
    })

    const add = Effect.fn("Batuta.add")(function* (activity: ConfigBatutaV1.Activity) {
      overlay.set(activity.id, activity)
      yield* cfgSvc.updateGlobal({ batuta: { [activity.id]: activity } } as unknown as ConfigV1.Info)
      return activity
    })

    const remove = Effect.fn("Batuta.remove")(function* (id: string) {
      overlay.set(id, undefined)
      yield* cfgSvc.updateGlobal({ batuta: { [id]: undefined } } as unknown as ConfigV1.Info)
    })

    const requireActivity = Effect.fn("Batuta.requireActivity")(function* (id: string) {
      const activities = yield* list()
      const activity = activities.find((item) => item.id === id)
      if (!activity) return yield* new NotFoundError({ id })
      return activity
    })

    const ensureBranch = Effect.fn("Batuta.ensureBranch")(function* (directory: string, branch: string) {
      const current = yield* git.branch(directory)
      if (current === branch) return
      // Try switching to it first (it may already exist); fall back to
      // creating it from the current HEAD if it doesn't.
      const switched = yield* git.run(["checkout", branch], { cwd: directory }).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (switched && switched.exitCode === 0) return
      yield* git.run(["checkout", "-b", branch], { cwd: directory }).pipe(
        Effect.catch((error) =>
          Effect.logError("Batuta.start: failed to create/switch branch", { branch, directory, error }),
        ),
      )
    })

    const start = Effect.fn("Batuta.start")(function* (id: string, opts?: { serverURL?: string }) {
      const activity = yield* requireActivity(id)

      if (activity.branch && activity.directory) {
        yield* ensureBranch(activity.directory, activity.branch)
      }

      // Worker isolation is mandatory, not configurable: every worker always
      // gets its own git worktree, so it can never write to the main checkout
      // directly — only the orchestrator decides what gets merged back.
      const workerDirectories = new Map<string, string>()
      for (const worker of activity.workers) {
        const info = yield* worktree.create({ name: worker.label }).pipe(
          Effect.catch((error) =>
            Effect.logError("Batuta.start: failed to create worker worktree", { worker: worker.label, error }).pipe(
              Effect.as(undefined),
            ),
          ),
        )
        if (info) workerDirectories.set(worker.id, info.directory)
      }

      if (activity.orchestratorKind === "external") {
        if (!activity.orchestratorCommand) {
          return yield* Effect.die(new Error(`Activity "${activity.name}" has no orchestratorCommand configured`))
        }
        const serverURL = opts?.serverURL
        if (!serverURL) {
          return yield* Effect.die(new Error("External orchestrator requires a serverURL to delegate back to"))
        }
        const updated: ConfigBatutaV1.Activity = {
          ...activity,
          phase: "orchestrating",
          architectSessionID: undefined,
          orchestratorSessionID: undefined,
        }
        yield* add(updated)
        runningExternal.set(id, { activity: updated, workerDirectories })

        const handle = yield* externalAgent
          .spawn({
            command: activity.orchestratorCommand,
            args: activity.orchestratorArgs,
            cwd: activity.directory ?? process.cwd(),
            env: { BATUTA_SERVER_URL: serverURL, BATUTA_ACTIVITY_ID: id },
          })
          .pipe(
            Effect.mapError(
              (e) =>
                new Error(`Failed to spawn external orchestrator "${activity.orchestratorCommand}": ${e.message}`),
            ),
            Effect.orDie,
          )
        // send() only writes to the PTY's stdin and returns — it doesn't wait
        // for the orchestrator to go idle, so this doesn't block start().
        yield* externalAgent
          .send(handle, externalOrchestratorInstructions(updated, serverURL))
          .pipe(Effect.catch(() => Effect.void))

        return { sessionID: id as SessionID, instructions: "" }
      }

      const orchestratorModel = parseModel(activity.orchestratorModel)
      const architectSession = yield* sessions.create({
        title: `${activity.name} — Arquiteto`,
        model: { id: orchestratorModel.modelID, providerID: orchestratorModel.providerID },
        directory: activity.directory,
      })

      // Worker worktrees are created up-front so the orchestrator (created
      // later, once the Architect hands off) can delegate immediately.
      pendingWorkerDirectories.set(id, workerDirectories)

      const updated: ConfigBatutaV1.Activity = {
        ...activity,
        phase: "architecting",
        architectSessionID: architectSession.id,
        orchestratorSessionID: undefined,
      }
      yield* add(updated)

      return { sessionID: architectSession.id, instructions: architectInstructions(updated) }
    })

    const checkHandoff = Effect.fn("Batuta.checkHandoff")(function* (id: string) {
      const activity = yield* requireActivity(id)
      if (activity.phase !== "architecting" || !activity.architectSessionID) return { activity }

      const directory = activity.directory ?? process.cwd()
      const handoff = yield* Effect.tryPromise(() => fs.readFile(HANDOFF_PATH(directory, id), "utf-8")).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!handoff) return { activity }

      const updated: ConfigBatutaV1.Activity = { ...activity, phase: "ready" }
      yield* add(updated)

      return { activity: updated, handoff }
    })

    // The user reviews the handoff on a "ready" activity and clicks "Iniciar
    // atividade" — only then is the orchestrator session actually created.
    const dispatch = Effect.fn("Batuta.dispatch")(function* (id: string) {
      const activity = yield* requireActivity(id)
      if (activity.phase !== "ready") return yield* new HandoffNotFoundError({ id })

      const directory = activity.directory ?? process.cwd()
      const handoff = yield* Effect.tryPromise(() => fs.readFile(HANDOFF_PATH(directory, id), "utf-8")).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!handoff) return yield* new HandoffNotFoundError({ id })

      const orchestratorModel = parseModel(activity.orchestratorModel)
      const orchestratorSession = yield* sessions.create({
        title: activity.name,
        model: { id: orchestratorModel.modelID, providerID: orchestratorModel.providerID },
        directory: activity.directory,
      })

      const workerDirectories = pendingWorkerDirectories.get(id) ?? new Map<string, string>()
      running.set(orchestratorSession.id, { activity, workerDirectories })
      pendingWorkerDirectories.delete(id)

      const updated: ConfigBatutaV1.Activity = {
        ...activity,
        phase: "orchestrating",
        orchestratorSessionID: orchestratorSession.id,
      }
      yield* add(updated)

      return { sessionID: orchestratorSession.id, instructions: orchestratorInstructions(updated, handoff) }
    })

    const readPipelineDefinition = Effect.fn("Batuta.readPipelineDefinition")(function* (id: string) {
      const activity = yield* requireActivity(id)
      const directory = activity.directory ?? process.cwd()
      return yield* Effect.tryPromise(() => fs.readFile(PIPELINE_DEFINITION_PATH(directory), "utf-8")).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
    })

    const writePipelineDefinition = Effect.fn("Batuta.writePipelineDefinition")(function* (
      id: string,
      content: string,
    ) {
      const activity = yield* requireActivity(id)
      const directory = activity.directory ?? process.cwd()
      const target = PIPELINE_DEFINITION_PATH(directory)
      yield* Effect.tryPromise(() => fs.mkdir(path.dirname(target), { recursive: true })).pipe(Effect.orDie)
      yield* Effect.tryPromise(() => fs.writeFile(target, content, "utf-8")).pipe(Effect.orDie)
    })

    // A dedicated, restricted session for chatting about docs/batuta-pipeline.md —
    // parented under the Architect (or Orchestrator) session so it never shows up
    // in the normal session list, same as any subagent, and permissioned so it can
    // only touch that one file (no bash, no delegating to other agents).
    const startPipelineChat = Effect.fn("Batuta.startPipelineChat")(function* (id: string) {
      const activity = yield* requireActivity(id)
      const orchestratorModel = parseModel(activity.orchestratorModel)
      const permission: PermissionV1.Ruleset = [
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "task", pattern: "*", action: "deny" },
        { permission: "edit", pattern: "*", action: "deny" },
        { permission: "write", pattern: "*", action: "deny" },
        { permission: "edit", pattern: PIPELINE_DEFINITION_RELATIVE, action: "allow" },
        { permission: "write", pattern: PIPELINE_DEFINITION_RELATIVE, action: "allow" },
      ]
      const session = yield* sessions.create({
        parentID: (activity.architectSessionID ?? activity.orchestratorSessionID) as SessionID | undefined,
        title: `${activity.name} — Fluxo do pipeline`,
        model: { id: orchestratorModel.modelID, providerID: orchestratorModel.providerID },
        directory: activity.directory,
        permission,
      })
      const instructions = `Você ajuda o usuário a editar o fluxo (pipeline) de desenvolvimento do Batuta para este projeto, guardado em "${PIPELINE_DEFINITION_RELATIVE}" (relativo à raiz do projeto).

Você só tem permissão para ler e escrever esse arquivo específico — não tente usar bash, delegar a outros agentes, ou editar qualquer outro arquivo do projeto.

O formato é: um heading "##" por fase do fluxo, seguido de uma lista de slugs das skills fixas do Batuta que pertencem a essa fase (ex: "- tdd"). Skills disponíveis:
${ConfigBatutaSkillsV1.SKILLS.map((skill) => `- ${skill.slug}: ${skill.description}`).join("\n")}

Leia o arquivo atual primeiro (se existir) antes de propor mudanças, e converse com o usuário para entender o que ele quer ajustar antes de escrever.`
      return { sessionID: session.id, instructions }
    })

    const resolveWorker = Effect.fn("Batuta.resolveWorker")(function* (orchestratorSessionID: string, label: string) {
      // V1: delegation only happens from the orchestrator session directly
      // (not from a grandchild), since that's the only session the running
      // activity is registered against.
      const entry = running.get(orchestratorSessionID)
      if (!entry) return undefined
      const worker = entry.activity.workers.find((item) => item.label === label)
      if (!worker) return undefined
      return { worker, directory: entry.workerDirectories.get(worker.id) }
    })

    const delegate = Effect.fn("Batuta.delegate")(function* (activityID: string, label: string, prompt: string) {
      const entry = runningExternal.get(activityID)
      if (!entry) return yield* new NotFoundError({ id: activityID })
      const worker = entry.activity.workers.find((item) => item.label === label)
      if (!worker) return yield* new WorkerNotFoundError({ id: activityID, label })
      const directory = entry.workerDirectories.get(worker.id) ?? entry.activity.directory ?? process.cwd()

      if (worker.kind === "external") {
        if (!worker.command) {
          return yield* Effect.die(new Error(`External worker "${worker.label}" has no command configured`))
        }
        const handle = yield* externalAgent
          .spawn({ command: worker.command, args: worker.args, cwd: directory })
          .pipe(
            Effect.mapError(
              (e) => new Error(`Failed to spawn external worker "${worker.label}" (${worker.command}): ${e.message}`),
            ),
            Effect.orDie,
          )
        const output = yield* externalAgent
          .send(handle, prompt)
          .pipe(Effect.flatMap(() => externalAgent.waitIdle(handle, { idleMs: worker.idleTimeoutMs })))
          .pipe(
            Effect.mapError(() => new Error(`External worker "${worker.label}" session vanished before it finished`)),
            Effect.ensuring(externalAgent.kill(handle)),
            Effect.orDie,
          )
        return { kind: "external" as const, output }
      }

      if (!worker.model) {
        return yield* Effect.die(new Error(`Internal worker "${worker.label}" has no model configured`))
      }
      const parsed = parseModel(worker.model)
      const session = yield* sessions.create({
        title: worker.label,
        model: { id: parsed.modelID, providerID: parsed.providerID },
        directory,
      })
      return { kind: "internal" as const, sessionID: session.id, model: parsed, prompt }
    })

    return Service.of({
      list,
      add,
      remove,
      start,
      checkHandoff,
      dispatch,
      resolveWorker,
      delegate,
      readPipelineDefinition,
      writePipelineDefinition,
      startPipelineChat,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Session.node, Worktree.node, Git.node, ExternalAgent.node],
})

export * as Batuta from "."
