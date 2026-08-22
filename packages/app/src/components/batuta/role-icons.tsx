import type { Component, JSX } from "solid-js"
import "./role-icons.css"

type IconProps = { class?: string; style?: JSX.CSSProperties; animated?: boolean }

/** Maestro mascot — the Orchestrator conducts and dispatches work, baton waving while busy. */
export const OrchestratorIcon: Component<IconProps> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    class={props.class}
    style={props.style}
    data-role-icon="orchestrator"
    data-animated={props.animated ? "true" : undefined}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" fill="#f59e0b" fill-opacity="0.18" />
    <circle cx="12" cy="12" r="10" stroke="#f59e0b" stroke-width="1.2" />
    {/* head */}
    <circle cx="12" cy="9.2" r="2.6" fill="#f2c9a0" />
    <path d="M9.6 8.4a2.4 2.4 0 0 1 4.8 0c0-.9-.3-1.4-.9-1.7-.4.5-1 .7-1.5.7s-1.1-.2-1.5-.7c-.6.3-.9.8-.9 1.7Z" fill="#3f2d1d" />
    {/* body */}
    <path d="M8 19c.4-2.6 1.8-4 4-4s3.6 1.4 4 4H8Z" fill="#78350f" />
    {/* baton arm */}
    <g data-part="baton">
      <path d="M12 15.2 L16 9.5" stroke="#f2c9a0" stroke-width="1.6" stroke-linecap="round" />
      <path d="M16 9.5 L18.2 6.6" stroke="#fbbf24" stroke-width="1.3" stroke-linecap="round" />
      <circle cx="18.2" cy="6.6" r="0.7" fill="#fde68a" />
    </g>
    <path d="M12 15.2 L8.4 13.6" stroke="#f2c9a0" stroke-width="1.6" stroke-linecap="round" />
  </svg>
)

/** Engineer mascot (hard hat + blueprint) — the Architect studies the project and drafts docs. */
export const ArchitectIcon: Component<IconProps> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    class={props.class}
    style={props.style}
    data-role-icon="architect"
    data-animated={props.animated ? "true" : undefined}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" fill="#7c3aed" fill-opacity="0.18" />
    <circle cx="12" cy="12" r="10" stroke="#7c3aed" stroke-width="1.2" />
    {/* hard hat */}
    <path d="M7.2 9.6a4.8 4.8 0 0 1 9.6 0v.6H7.2v-.6Z" fill="#fbbf24" />
    <rect x="6.6" y="10.1" width="10.8" height="1.3" rx="0.6" fill="#f59e0b" />
    {/* face */}
    <rect x="8.4" y="11.4" width="7.2" height="5.6" rx="2.6" fill="#f2c9a0" />
    <g data-part="eyes">
      <circle cx="10.1" cy="13.6" r="0.55" fill="#3f2d1d" />
      <circle cx="13.9" cy="13.6" r="0.55" fill="#3f2d1d" />
    </g>
    <path d="M9.6 15.6c.7.5 1.6.8 2.4.8s1.7-.3 2.4-.8" stroke="#3f2d1d" stroke-width="0.7" stroke-linecap="round" />
    {/* blueprint roll */}
    <rect x="15.6" y="15.4" width="1.6" height="4.4" rx="0.8" fill="#e2e8f0" />
  </svg>
)

/** Worker mascot (overalls + cap) — executes a delegated task, arm waving (as if working) while busy. */
export const WorkerIcon: Component<IconProps> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    class={props.class}
    style={props.style}
    data-role-icon="worker"
    data-animated={props.animated ? "true" : undefined}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" fill="#f97316" fill-opacity="0.18" />
    <circle cx="12" cy="12" r="10" stroke="#f97316" stroke-width="1.2" />
    {/* cap */}
    <path d="M8.4 9.4a3.6 3.6 0 0 1 7.2 0v.4H8.4v-.4Z" fill="#fb923c" />
    <rect x="7.8" y="9.7" width="8.4" height="1.1" rx="0.55" fill="#ea580c" />
    {/* face */}
    <rect x="9.2" y="10.8" width="5.6" height="4.6" rx="2" fill="#f2c9a0" />
    <circle cx="10.6" cy="12.7" r="0.45" fill="#3f2d1d" />
    <circle cx="13.4" cy="12.7" r="0.45" fill="#3f2d1d" />
    {/* overalls body */}
    <path d="M8.6 20c.3-2.3 1.6-3.6 3.4-3.6s3.1 1.3 3.4 3.6H8.6Z" fill="#fb923c" />
    {/* working arm (broom/bucket motion) */}
    <g data-part="arm">
      <path d="M14.4 17 L17.4 14.2" stroke="#f2c9a0" stroke-width="1.5" stroke-linecap="round" />
      <path d="M17.4 14.2 L18.6 12.4" stroke="#78350f" stroke-width="1.1" stroke-linecap="round" />
    </g>
  </svg>
)
