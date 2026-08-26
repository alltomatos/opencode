export type KnownExternalAgent = {
  readonly id: string
  readonly name: string
  readonly bin: string
}

export const KNOWN_EXTERNAL_AGENTS: readonly KnownExternalAgent[] = [
  { id: "claude", name: "Claude Code", bin: "claude" },
  { id: "codex", name: "Codex", bin: "codex" },
]
