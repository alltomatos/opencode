export type McpToolRef = { server: string; tool: string }

function pad(n: number) {
  return String(n).padStart(2, "0")
}

export function triggerSummary(trigger: { kind: string; expr?: string; ms?: number | string; timestamp?: number | string }): string {
  if (trigger.kind === "once" && typeof trigger.timestamp === "number" && !isNaN(trigger.timestamp)) {
    const d = new Date(trigger.timestamp)
    return `Único em ${d.toLocaleDateString("pt-BR")} às ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
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
  agentId?: string
  message?: string
}): string {
  if (action.kind === "shell") return action.command ?? ""
  if (action.kind === "mcp_tool") return `${action.server}/${action.tool}`
  if (action.kind === "agentui") return `[AgentUI] ${action.message ?? ""}`
  if (action.kind === "reminder") return `[Lembrete] ${action.message ?? ""}`
  const tools = action.mcpTools?.length
    ? ` · ferramentas: ${Array.from(new Set(action.mcpTools.map((t) => t.server))).join(", ")}`
    : ""
  return `${action.instructions ?? ""}${tools}`
}

function matchCronPart(part: string, value: number, min: number): boolean {
  if (part === "*") return true
  if (part.startsWith("*/")) {
    const step = parseInt(part.slice(2), 10)
    if (isNaN(step) || step <= 0) return false
    return (value - min) % step === 0
  }
  if (part.includes(",")) {
    return part.split(",").some((sub) => matchCronPart(sub.trim(), value, min))
  }
  if (part.includes("-")) {
    const [startStr, endStr] = part.split("-")
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    if (isNaN(start) || isNaN(end)) return false
    return value >= start && value <= end
  }
  const num = parseInt(part, 10)
  return !isNaN(num) && num === value
}

export function matchesCronExpr(cron: string, date: Date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const minute = date.getMinutes()
  const hour = date.getHours()
  const dayOfMonth = date.getDate()
  const month = date.getMonth() + 1
  const dayOfWeek = date.getDay()

  if (!matchCronPart(parts[0], minute, 0)) return false
  if (!matchCronPart(parts[1], hour, 0)) return false
  if (!matchCronPart(parts[3], month, 1)) return false

  const domPart = parts[2]
  const dowPart = parts[4]
  const domRestricted = domPart !== "*"
  const dowRestricted = dowPart !== "*"
  const domMatch = matchCronPart(domPart, dayOfMonth, 1)
  const dowMatch = matchCronPart(dowPart, dayOfWeek, 0) || (dayOfWeek === 0 && matchCronPart(dowPart, 7, 0))

  if (domRestricted && dowRestricted) {
    if (!domMatch && !dowMatch) return false
  } else {
    if (domRestricted && !domMatch) return false
    if (dowRestricted && !dowMatch) return false
  }

  return true
}

export function computeNextRun(
  trigger: { kind: string; expr?: string; ms?: number | string; timestamp?: number | string },
  lastRunAt?: number,
  fromDateMs: number = Date.now(),
): number | null {
  if (trigger.kind === "manual") return null

  if (trigger.kind === "once") {
    const ts = typeof trigger.timestamp === "number" ? trigger.timestamp : Number(trigger.timestamp)
    if (isNaN(ts)) return null
    if (lastRunAt && lastRunAt >= ts) return null
    return ts
  }

  if (trigger.kind === "interval") {
    const ms = typeof trigger.ms === "number" ? trigger.ms : Number(trigger.ms)
    if (isNaN(ms) || ms <= 0) return null
    if (lastRunAt) {
      const next = lastRunAt + ms
      return next
    }
    return fromDateMs + ms
  }

  if (trigger.kind === "cron" && trigger.expr) {
    const expr = trigger.expr.trim()
    // Look ahead from current minute boundary + 1 minute up to 30 days
    const startMs = Math.floor(fromDateMs / 60_000) * 60_000 + 60_000
    const maxMs = startMs + 30 * 24 * 60 * 60_000
    for (let t = startMs; t <= maxMs; t += 60_000) {
      if (matchesCronExpr(expr, new Date(t))) {
        return t
      }
    }
  }

  return null
}
