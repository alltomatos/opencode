export type McpToolRef = { server: string; tool: string }

function pad(n: number) {
  return String(n).padStart(2, "0")
}

export function triggerSummary(trigger: { kind: string; expr?: string; ms?: number | string }): string {
  if (trigger.kind === "cron") {
    const parts = String(trigger.expr ?? "").split(" ")
    if (
      parts.length === 5 &&
      parts[0] !== "*" &&
      parts[1] !== "*" &&
      parts[2] === "*" &&
      parts[3] === "*" &&
      parts[4] === "*"
    ) {
      return `Todo dia às ${pad(Number(parts[1]))}:${pad(Number(parts[0]))}`
    }
    return `cron: ${trigger.expr}`
  }
  if (trigger.kind === "interval") {
    const minutes = Math.round(Number(trigger.ms ?? 0) / 60_000)
    if (minutes % 60 === 0 && minutes > 0) return `A cada ${minutes / 60}h`
    return `A cada ${minutes}min`
  }
  return "Manual"
}

export function actionSummary(action: {
  kind: string
  command?: string
  server?: string
  tool?: string
  instructions?: string
  mcpTools?: readonly McpToolRef[]
}): string {
  if (action.kind === "shell") return action.command ?? ""
  if (action.kind === "mcp_tool") return `${action.server}/${action.tool}`
  const tools = action.mcpTools?.length ? ` · usa ${action.mcpTools.map((t) => t.tool).join(", ")}` : ""
  return `${action.instructions ?? ""}${tools}`
}
