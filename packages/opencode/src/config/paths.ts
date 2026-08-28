export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

// Callers (project.ts, storage.ts) use "/" as a POSIX-style sentinel for
// "no real git worktree — walk to the true filesystem root". afs.up() stops
// via strict string equality against the current directory, so on Windows
// ("/" never equals a drive-rooted path like "C:\\") that comparison never
// fires; the walk only halts once it separately notices dirname(current)
// stopped changing, by which point it has already climbed through — and
// picked up config from — real ancestor directories (e.g. the user's actual
// home) it was never meant to reach. Resolving the sentinel to the actual
// platform root up front makes the stop condition match immediately, same
// as it always has on POSIX.
function resolveStop(directory: string, worktree?: string) {
  return worktree === "/" ? path.parse(directory).root : worktree
}

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: resolveStop(directory, worktree),
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".opencode"],
          start: directory,
          stop: resolveStop(directory, worktree),
        })
      : []),
    ...(yield* afs.up({
      targets: [".opencode"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
