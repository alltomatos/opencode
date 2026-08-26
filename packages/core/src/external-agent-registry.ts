export type KnownExternalAgent = {
  readonly id: string
  readonly name: string
  readonly bin: string
  // Relative to the connected server's home directory — where this CLI looks up skills.
  readonly skillsDir: string
}

export const KNOWN_EXTERNAL_AGENTS: readonly KnownExternalAgent[] = [
  { id: "claude", name: "Claude Code", bin: "claude", skillsDir: ".claude/skills" },
  { id: "codex", name: "Codex", bin: "codex", skillsDir: ".codex/skills" },
]
