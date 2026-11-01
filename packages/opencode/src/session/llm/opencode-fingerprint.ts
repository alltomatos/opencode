import { jsonSchema, tool, type Tool } from "ai"
import { ShellPrompt } from "../../tool/shell/prompt"
import READ_DESCRIPTION from "../../tool/read.txt"
import EDIT_DESCRIPTION from "../../tool/edit.txt"
import WRITE_DESCRIPTION from "../../tool/write.txt"

/**
 * Tool declarations the hosted OpenCode free lane fingerprints.
 *
 * The upstream gate only serves free models to requests shaped like a native
 * CLI turn: besides the client headers it expects the standard `bash`, `edit`,
 * `read` and `write` declarations (a missing or dummy tool set is rejected as
 * `FreeTierError`). Tool-less calls — title generation and compaction — used to
 * send a single `_noop` tool and were therefore refused even though the real
 * chat turn succeeded.
 *
 * These are declarations only: no `execute`, so a model that calls one ends its
 * turn instead of running anything inside a helper request.
 */
const bash = ShellPrompt.render(
  "bash",
  process.platform,
  { maxLines: 2_000, maxBytes: 50 * 1024 },
  // Matches the default bash timeout used by the shell tool.
  2 * 60 * 1000,
)

type JsonSchema = Exclude<Parameters<typeof jsonSchema>[0], PromiseLike<unknown> | (() => unknown)>

const declarations: { name: string; description: string; parameters: JsonSchema }[] = [
  {
    name: "bash",
    description: bash.description,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute" },
        timeout: {
          type: "integer",
          description: "Optional timeout in milliseconds",
          exclusiveMinimum: 0,
        },
        workdir: {
          type: "string",
          description:
            "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "edit",
    description: EDIT_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "The absolute path to the file to modify" },
        oldString: { type: "string", description: "The text to replace" },
        newString: {
          type: "string",
          description: "The text to replace it with (must be different from oldString)",
        },
        replaceAll: {
          type: "boolean",
          description: "Replace all occurrences of oldString (default false)",
        },
      },
      required: ["filePath", "oldString", "newString"],
    },
  },
  {
    name: "read",
    description: READ_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "The absolute path to the file or directory to read" },
        offset: {
          type: "integer",
          description: "The line number to start reading from (1-indexed)",
          minimum: 0,
        },
        limit: {
          type: "integer",
          description: "The maximum number of lines to read (defaults to 2000)",
          minimum: 0,
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "write",
    description: WRITE_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The content to write to the file" },
        filePath: {
          type: "string",
          description: "The absolute path to the file to write (must be absolute, not relative)",
        },
      },
      required: ["content", "filePath"],
    },
  },
]

export const names = declarations.map((item) => item.name)

export function tools(): Record<string, Tool> {
  return Object.fromEntries(
    declarations.map((item) => [
      item.name,
      tool({
        description: item.description,
        inputSchema: jsonSchema(item.parameters),
      }),
    ]),
  )
}

/**
 * Adds any missing fixture declarations without replacing the caller's real
 * tools. The upstream gate checks the whole quartet, so a restricted agent that
 * only exposes one of them must still carry the other declarations.
 */
export function augment(tools: Record<string, Tool>) {
  for (const item of declarations) {
    if (tools[item.name]) continue
    tools[item.name] = tool({
      description: item.description,
      inputSchema: jsonSchema(item.parameters),
    })
  }
  return tools
}

export function isFree(model: { id: string; cost?: { input?: number } }) {
  return model.id.endsWith("-free") || model.cost?.input === 0
}

export * as OpencodeFingerprint from "./opencode-fingerprint"
