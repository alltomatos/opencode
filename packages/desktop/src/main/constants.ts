import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// "dev" channel builds are now real, CI-published artifacts (release-desktop-dev.yml)
// with their own update feed — only a local, unpackaged `bun run dev` run should skip
// the updater, same as beta/prod already do via `app.isPackaged`.
export const UPDATER_ENABLED = app.isPackaged
