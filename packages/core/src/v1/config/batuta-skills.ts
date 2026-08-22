export * as ConfigBatutaSkillsV1 from "./batuta-skills"

/**
 * Fixed catalog of skills the Batuta orchestrator can delegate to via the
 * task tool (subagent_type = slug). Matches the user's own delegation table
 * from the alltomatos/skills framework — intentionally not dynamically
 * discovered for this iteration.
 */
export interface Skill {
  slug: string
  label: string
  description: string
}

export const SKILLS: Skill[] = [
  { slug: "orchestrator", label: "Orchestrator", description: "Coordinates delegation across the other skills" },
  { slug: "roadmap", label: "Roadmap", description: "Maintains ROADMAP.md-style planning artifacts" },
  { slug: "setup-skills", label: "Setup Skills", description: "Bootstraps the skills framework in a project" },
  {
    slug: "grill-with-docs",
    label: "Grill with Docs",
    description: "Interrogates requirements against existing documentation",
  },
  {
    slug: "grill-feature-with-docs",
    label: "Grill Feature with Docs",
    description: "Interrogates a specific feature request against existing documentation",
  },
  { slug: "to-issues", label: "To Issues", description: "Slices a piece of work into discrete issues" },
  { slug: "to-prd", label: "To PRD", description: "Writes a Product Requirements Document" },
  { slug: "diagnose", label: "Diagnose", description: "Root-causes a bug or incident" },
  { slug: "tdd", label: "TDD", description: "Implements a change test-first" },
  { slug: "query-docs", label: "Query Docs", description: "Answers questions from project documentation" },
  { slug: "secure-e2e", label: "Secure E2E", description: "Writes security-focused end-to-end tests" },
  { slug: "qa-analyst", label: "QA Analyst", description: "Reviews a change from a QA perspective" },
  {
    slug: "improve-codebase-architecture",
    label: "Improve Codebase Architecture",
    description: "Proposes architectural improvements",
  },
  { slug: "prototype", label: "Prototype", description: "Builds a throwaway prototype to validate an idea" },
  { slug: "scaffold-mvp", label: "Scaffold MVP", description: "Scaffolds a minimal viable implementation" },
  { slug: "zoom-out", label: "Zoom Out", description: "Steps back to reassess the broader context" },
  { slug: "write-a-skill", label: "Write a Skill", description: "Authors a new skill" },
  { slug: "grill-me", label: "Grill Me", description: "Interrogates the user to sharpen an ambiguous request" },
  { slug: "handoff", label: "Handoff", description: "Packages context and hands work off to another agent" },
]

export const bySlug = new Map(SKILLS.map((skill) => [skill.slug, skill]))
