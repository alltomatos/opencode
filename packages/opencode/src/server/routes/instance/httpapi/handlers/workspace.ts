import { listAdapters } from "@/control-plane/adapters"
import { Workspace } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Vcs } from "@/project/vcs"
import { Global } from "@opencode-ai/core/global"
import { Cause, Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import nodeFs from "node:fs"
import path from "path"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"
import { ApiVcsApplyError } from "../groups/instance"
import { ApiWorkspaceCreateError, ApiWorkspaceWarpError, CreatePayload, WarpPayload } from "../groups/workspace"

export const workspaceHandlers = HttpApiBuilder.group(InstanceHttpApi, "workspace", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service

    const adapters = Effect.fn("WorkspaceHttpApi.adapters")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.sync(() => listAdapters(instance.project.id))
    })

    const list = Effect.fn("WorkspaceHttpApi.list")(function* () {
      return yield* workspace.list((yield* InstanceState.context).project)
    })

    const create = Effect.fn("WorkspaceHttpApi.create")(function* (ctx: { payload: typeof CreatePayload.Type }) {
      const instance = yield* InstanceState.context
      let directory: string | undefined

      if (ctx.payload.source) {
        if (ctx.payload.source.type === "existing") {
          const exists = nodeFs.existsSync(ctx.payload.source.path)
          if (!exists) {
            return yield* Effect.fail(
              new ApiWorkspaceCreateError({
                name: "WorkspaceCreateError",
                data: { message: `Directory does not exist: ${ctx.payload.source.path}` },
              }),
            )
          }
          directory = ctx.payload.source.path
        } else if (ctx.payload.source.type === "clone") {
          const url = ctx.payload.source.url?.trim()
          if (!url) {
            return yield* Effect.fail(
              new ApiWorkspaceCreateError({
                name: "WorkspaceCreateError",
                data: { message: "Clone repository URL must not be empty" },
              }),
            )
          }

          const rawRepoName = path.basename(url.replace(/\.git\/?$/, "")) || "repo"
          const repoName = rawRepoName.replace(/[^a-zA-Z0-9._-]/g, "_")
          const targetDir = ctx.payload.source.destination
            ? path.resolve(ctx.payload.source.destination)
            : path.join(Global.Path.repos, repoName)

          const alreadyExists = nodeFs.existsSync(targetDir)
          if (alreadyExists) {
            return yield* Effect.fail(
              new ApiWorkspaceCreateError({
                name: "WorkspaceCreateError",
                data: { message: `Destination directory already exists: ${targetDir}` },
              }),
            )
          }

          try {
            nodeFs.mkdirSync(path.dirname(targetDir), { recursive: true })
          } catch (err: any) {
            return yield* Effect.fail(
              new ApiWorkspaceCreateError({
                name: "WorkspaceCreateError",
                data: { message: `Failed to create parent directory for clone: ${err.message}` },
              }),
            )
          }

          const args = [
            "clone",
            "--depth",
            "100",
            ...(ctx.payload.branch ? ["--branch", ctx.payload.branch] : []),
            "--",
            url,
            targetDir,
          ]

          const [code, stdout, stderr] = yield* Effect.scoped(
            Effect.gen(function* () {
              const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
              const handle = yield* spawner.spawn(
                ChildProcess.make("git", args, { extendEnv: true, stdin: "ignore" }),
              )
              const [out, err] = yield* Effect.all(
                [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
                { concurrency: 2 },
              ).pipe(Effect.catch(() => Effect.succeed(["", ""])))
              const exitCode = yield* handle.exitCode.pipe(Effect.catch(() => Effect.succeed(1)))
              return [exitCode, out, err] as const
            }),
          ).pipe(
            Effect.catch((err: any) =>
              Effect.fail(
                new ApiWorkspaceCreateError({
                  name: "WorkspaceCreateError",
                  data: { message: `Failed to spawn git process: ${err?.message ?? err}` },
                }),
              ),
            ),
          )

          if (code !== 0) {
            const rawErr = stderr.trim() || stdout.trim() || `git clone exited with code ${code}`
            let cleanMsg = `Git clone failed: ${rawErr}`
            if (
              rawErr.includes("Authentication failed") ||
              rawErr.includes("Permission denied") ||
              rawErr.includes("could not read Username")
            ) {
              cleanMsg = `Git authentication failed for repository: ${url}`
            } else if (rawErr.includes("not found") || rawErr.includes("Could not resolve host")) {
              cleanMsg = `Git repository not found or invalid URL: ${url}`
            } else if (rawErr.includes("No space left on device")) {
              cleanMsg = "Git clone failed: No space left on device"
            }
            return yield* Effect.fail(
              new ApiWorkspaceCreateError({
                name: "WorkspaceCreateError",
                data: { message: cleanMsg },
              }),
            )
          }

          directory = targetDir
        }
      }

      return yield* workspace
        .create({
          ...ctx.payload,
          extra: {
            ...((ctx.payload.extra as Record<string, unknown>) ?? {}),
            ...(directory ? { directory } : {}),
          },
          projectID: instance.project.id,
        })
        .pipe(
          Effect.catchCause((cause) => {
            // Plugin throws surface as defects (because EffectBridge.fromPromise uses Effect.promise),
            // bypassing Effect.mapError. Walk the cause to surface the real error to the client.
            const die = cause.reasons.find(Cause.isDieReason)
            const fail = cause.reasons.find(Cause.isFailReason)
            const reason: unknown = die?.defect ?? fail?.error
            const message = reason instanceof Error ? reason.message : "Workspace creation failed"
            return Effect.fail(
              new ApiWorkspaceCreateError({
                name: "WorkspaceCreateError",
                data: { message },
              }),
            )
          }),
        )
    })

    const syncList = Effect.fn("WorkspaceHttpApi.syncList")(function* () {
      yield* workspace.syncList((yield* InstanceState.context).project)
    })

    const status = Effect.fn("WorkspaceHttpApi.status")(function* () {
      const ids = new Set((yield* workspace.list((yield* InstanceState.context).project)).map((item) => item.id))
      return (yield* workspace.status()).filter((item) => ids.has(item.workspaceID))
    })

    const remove = Effect.fn("WorkspaceHttpApi.remove")(function* (ctx: { params: { id: Workspace.Info["id"] } }) {
      return yield* workspace.remove(ctx.params.id)
    })

    const warp = Effect.fn("WorkspaceHttpApi.warp")(function* (ctx: { payload: typeof WarpPayload.Type }) {
      yield* workspace
        .sessionWarp({
          workspaceID: ctx.payload.id,
          sessionID: ctx.payload.sessionID,
          copyChanges: ctx.payload.copyChanges,
        })
        .pipe(
          Effect.mapError((error) => {
            if (error instanceof Workspace.WorkspaceNotFoundError) return notFound(error.message)
            if (error instanceof Vcs.PatchApplyError) {
              return new ApiVcsApplyError({
                name: "VcsApplyError",
                data: {
                  message: error.message,
                  reason: error.reason,
                },
              })
            }
            return new ApiWorkspaceWarpError({
              name: "WorkspaceWarpError",
              data: {
                message: error.message,
              },
            })
          }),
        )
    })

    return handlers
      .handle("adapters", adapters)
      .handle("list", list)
      .handle("create", create)
      .handle("createWorkspace", create)
      .handle("syncList", syncList)
      .handle("status", status)
      .handle("remove", remove)
      .handle("warp", warp)
  }),
)
