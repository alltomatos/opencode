import type { Session } from "@opencode-ai/sdk/v2/client"

export type StatsDateRange = "today" | "7d" | "30d" | "all"

export interface ModelStat {
  key: string
  name: string
  providerID: string
  tokens: number
  output: number
  input: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  sessions: number
}

export interface AgentStat {
  name: string
  tokens: number
  output: number
  input: number
  reasoning: number
  sessions: number
}

export interface ProjectStat {
  id: string
  name: string
  directory: string
  tokens: number
  cost: number
  sessions: number
}

export interface DailyStat {
  date: string
  label: string
  tokens: number
  input: number
  output: number
  reasoning: number
  cost: number
  sessions: number
  durationMs: number
}

export interface SessionSummaryStat {
  id: string
  title: string
  directory: string
  projectName: string
  model: string
  providerID: string
  agent: string
  tokensTotal: number
  input: number
  output: number
  reasoning: number
  cost: number
  time: number
  durationMs: number
  durationFormatted: string
}

export interface StatsSummary {
  totalTokens: number
  outputTokens: number
  inputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheRatio: number
  totalCost: number
  totalSessions: number
  avgTokensPerSession: number
  avgCostPerSession: number
  totalDurationMs: number
  longestDurationMs: number
  longestSessionTitle: string
  avgDurationMs: number
  breakdownByModel: ModelStat[]
  breakdownByAgent: AgentStat[]
  breakdownByProject: ProjectStat[]
  dailyActivity: DailyStat[]
  recentSessions: SessionSummaryStat[]
}

export interface ComputeStatsOptions {
  range: StatsDateRange
  projectID?: string
  now?: number
}

const MS_PER_DAY = 86_400_000

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

export function formatMinutes(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min"
  const mins = Math.round(ms / 60000)
  return `${mins.toLocaleString()} min`
}

export function getCutoffTime(range: StatsDateRange, now = Date.now()): number {
  if (range === "all") return 0
  if (range === "today") {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (range === "7d") return now - 7 * MS_PER_DAY
  if (range === "30d") return now - 30 * MS_PER_DAY
  return 0
}

export function computeStats(sessions: Session[], options: ComputeStatsOptions): StatsSummary {
  const now = options.now ?? Date.now()
  const cutoff = getCutoffTime(options.range, now)

  const filtered = sessions.filter((s) => {
    const updated = s.time?.updated ?? s.time?.created ?? 0
    if (cutoff > 0 && updated < cutoff) return false
    if (options.projectID && options.projectID !== "all" && s.projectID !== options.projectID) return false
    return true
  })

  let totalTokens = 0
  let outputTokens = 0
  let inputTokens = 0
  let reasoningTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let totalCost = 0
  let totalDurationMs = 0
  let longestDurationMs = 0
  let longestSessionTitle = ""

  const modelMap = new Map<string, ModelStat>()
  const agentMap = new Map<string, AgentStat>()
  const projectMap = new Map<string, ProjectStat>()
  const dailyMap = new Map<string, DailyStat>()
  const sessionList: SessionSummaryStat[] = []

  for (const s of filtered) {
    const tok = s.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    const inp = Number.isFinite(tok.input) ? Math.max(0, tok.input) : 0
    const out = Number.isFinite(tok.output) ? Math.max(0, tok.output) : 0
    const reas = Number.isFinite(tok.reasoning) ? Math.max(0, tok.reasoning) : 0
    const cr = Number.isFinite(tok.cache?.read) ? Math.max(0, tok.cache.read) : 0
    const cw = Number.isFinite(tok.cache?.write) ? Math.max(0, tok.cache.write) : 0
    const sessionTokTotal = inp + out + reas + cr + cw
    const cost = typeof s.cost === "number" && Number.isFinite(s.cost) ? Math.max(0, s.cost) : 0

    const created = s.time?.created ?? 0
    const updated = s.time?.updated ?? created
    const durationMs = Math.max(0, updated - created)

    totalTokens += sessionTokTotal
    outputTokens += out
    inputTokens += inp
    reasoningTokens += reas
    cacheReadTokens += cr
    cacheWriteTokens += cw
    totalCost += cost
    totalDurationMs += durationMs

    if (durationMs > longestDurationMs) {
      longestDurationMs = durationMs
      longestSessionTitle = s.title || s.id
    }

    // Model breakdown
    const modelID = typeof s.model === "object" && s.model !== null ? (s.model as any).modelID ?? (s.model as any).id ?? "default" : "default"
    const providerID = typeof s.model === "object" && s.model !== null ? (s.model as any).providerID ?? "" : ""
    const modelKey = providerID ? `${providerID}/${modelID}` : modelID
    const existingModel = modelMap.get(modelKey) ?? {
      key: modelKey,
      name: modelID,
      providerID,
      tokens: 0,
      output: 0,
      input: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      sessions: 0,
    }
    existingModel.tokens += sessionTokTotal
    existingModel.output += out
    existingModel.input += inp
    existingModel.reasoning += reas
    existingModel.cacheRead += cr
    existingModel.cacheWrite += cw
    existingModel.cost += cost
    existingModel.sessions += 1
    modelMap.set(modelKey, existingModel)

    // Agent breakdown
    const agentName = s.agent || "default"
    const existingAgent = agentMap.get(agentName) ?? {
      name: agentName,
      tokens: 0,
      output: 0,
      input: 0,
      reasoning: 0,
      sessions: 0,
    }
    existingAgent.tokens += sessionTokTotal
    existingAgent.output += out
    existingAgent.input += inp
    existingAgent.reasoning += reas
    existingAgent.sessions += 1
    agentMap.set(agentName, existingAgent)

    // Project breakdown
    const projId = s.projectID || s.directory || "unknown"
    const projDir = s.directory || ""
    const existingProj = projectMap.get(projId) ?? {
      id: projId,
      name: projDir.split(/[/\\]/).filter(Boolean).pop() || projId,
      directory: projDir,
      tokens: 0,
      cost: 0,
      sessions: 0,
    }
    existingProj.tokens += sessionTokTotal
    existingProj.cost += cost
    existingProj.sessions += 1
    projectMap.set(projId, existingProj)

    // Daily activity
    const timestamp = updated || created || now
    const d = new Date(timestamp)
    const dateKey = d.toISOString().slice(0, 10)
    const label = `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`
    const existingDaily = dailyMap.get(dateKey) ?? {
      date: dateKey,
      label,
      tokens: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cost: 0,
      sessions: 0,
      durationMs: 0,
    }
    existingDaily.tokens += sessionTokTotal
    existingDaily.input += inp
    existingDaily.output += out
    existingDaily.reasoning += reas
    existingDaily.cost += cost
    existingDaily.sessions += 1
    existingDaily.durationMs += durationMs
    dailyMap.set(dateKey, existingDaily)

    sessionList.push({
      id: s.id,
      title: s.title || s.id,
      directory: s.directory || "",
      projectName: existingProj.name,
      model: modelKey,
      providerID,
      agent: agentName,
      tokensTotal: sessionTokTotal,
      input: inp,
      output: out,
      reasoning: reas,
      cost,
      time: timestamp,
      durationMs,
      durationFormatted: formatDuration(durationMs),
    })
  }

  const totalSessions = filtered.length
  const avgTokensPerSession = totalSessions > 0 ? Math.round(totalTokens / totalSessions) : 0
  const avgCostPerSession = totalSessions > 0 ? totalCost / totalSessions : 0
  const avgDurationMs = totalSessions > 0 ? Math.round(totalDurationMs / totalSessions) : 0
  const totalPromptTokens = inputTokens + cacheReadTokens
  const cacheRatio = totalPromptTokens > 0 ? Math.round((cacheReadTokens / totalPromptTokens) * 100) : 0

  const breakdownByModel = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens)
  const breakdownByAgent = [...agentMap.values()].sort((a, b) => b.tokens - a.tokens)
  const breakdownByProject = [...projectMap.values()].sort((a, b) => b.tokens - a.tokens)
  const dailyActivity = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const recentSessions = sessionList.sort((a, b) => b.time - a.time)

  return {
    totalTokens,
    outputTokens,
    inputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheRatio,
    totalCost,
    totalSessions,
    avgTokensPerSession,
    avgCostPerSession,
    totalDurationMs,
    longestDurationMs,
    longestSessionTitle,
    avgDurationMs,
    breakdownByModel,
    breakdownByAgent,
    breakdownByProject,
    dailyActivity,
    recentSessions,
  }
}
