import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"

function deletionOnly(part: ToolPart) {
  if (!("metadata" in part.state)) return false
  const metadata = part.state.metadata
  if (!metadata) return false

  const files = metadata.files
  if (Array.isArray(files) && files.length > 0) {
    return files.every((file) => !!file && typeof file === "object" && "type" in file && file.type === "delete")
  }

  const filediff = metadata.filediff
  if (!filediff || typeof filediff !== "object") return false
  if (!("additions" in filediff) || !("deletions" in filediff)) return false
  return filediff.additions === 0 && typeof filediff.deletions === "number" && filediff.deletions > 0
}

function toolFilePaths(part: ToolPart): string[] {
  const filePath = part.state.input.filePath
  if (typeof filePath === "string") return [filePath]

  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  const files = metadata && typeof metadata === "object" ? (metadata as { files?: unknown }).files : undefined
  if (!Array.isArray(files)) return []
  return files
    .map((file) => (file && typeof file === "object" && "filePath" in file ? file.filePath : undefined))
    .filter((value): value is string => typeof value === "string")
}

function onlyMarkdownFiles(part: ToolPart) {
  const paths = toolFilePaths(part)
  if (paths.length === 0) return false
  return paths.every((path) => path.toLowerCase().endsWith(".md"))
}

export function partDefaultOpen(part: PartType, shell = false, edit = false) {
  if (part.type !== "tool") return
  if (part.tool === "bash" || part.tool === "shell") return shell
  if (part.tool === "edit" || part.tool === "write" || part.tool === "patch" || part.tool === "apply_patch") {
    if (onlyMarkdownFiles(part)) return false
    if (!edit) return false
    return !deletionOnly(part)
  }
}
