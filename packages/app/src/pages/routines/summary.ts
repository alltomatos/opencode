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
      const minutes = parts[0].split(",")
      const hours = parts[1].split(",")
      if (hours.length === 1 && minutes.length === 1) {
        return `Todo dia às ${pad(Number(hours[0]))}:${pad(Number(minutes[0]))}`
      }
      return `Todo dia (${hours.map((h) => `${pad(Number(h))}:00`).join(", ")})`
    }
    if (
      parts.length === 5 &&
      parts[0] !== "*" &&
      parts[1] !== "*" &&
      parts[2] === "*" &&
      parts[3] === "*" &&
      parts[4] === "1-5"
    ) {
      const minutes = parts[0].split(",")
      const hours = parts[1].split(",")
      if (hours.length === 1 && minutes.length === 1) {
        return `Dias úteis às ${pad(Number(hours[0]))}:${pad(Number(minutes[0]))}`
      }
      return `Dias úteis (${hours.map((h) => `${pad(Number(h))}:00`).join(", ")})`
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
  model?: string
  permission?: string
}): string {
  if (action.kind === "shell") return action.command ?? ""
  if (action.kind === "mcp_tool") return `${action.server}/${action.tool}`
  const tools = action.mcpTools?.length
    ? ` · ferramentas: ${Array.from(new Set(action.mcpTools.map((t) => t.server))).join(", ")}`
    : ""
  return `${action.instructions ?? ""}${tools}`
}
