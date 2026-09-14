export * as ConfigSchedule from "./schedule"

import path from "path"
import { Cause, Exit, Schema } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { Schedule } from "@opencode-ai/schema/schedule"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import * as ConfigMarkdown from "./markdown"

const decodeInfo = Schema.decodeUnknownExit(Schedule.Info)

export async function load(dir: string) {
  const result: Record<string, Schedule.Info> = {}
  for (const item of await Glob.scan("{schedule,schedules}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["schedule/", "schedules/"])

    const config = {
      id: Schedule.ID.create(),
      name,
      ...md.data,
      command: (md.data as any).command || md.content.trim(),
    }
    const parsed = decodeInfo(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[name] = parsed.value
      continue
    }
    throw new InvalidError({ path: item, message: Cause.pretty(parsed.cause) }, { cause: Cause.squash(parsed.cause) })
  }
  return result
}
