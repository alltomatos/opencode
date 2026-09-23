import { $ } from "bun"
import { join } from "node:path"
import { downloadCliToResources } from "./utils"

const channel = process.env.OPENCODE_CHANNEL ?? "dev"
const desktopPkg = await Bun.file(join(import.meta.dirname, "..", "package.json")).json()
process.env.OPENCODE_VERSION ??= desktopPkg.version
process.env.OPENCODE_CHANNEL ??= channel

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`bun build ../mcpmail/src/index.ts --target=node --outfile=./resources/mcpmail/index.js`

await $`cd ../opencode && bun script/build-node.ts`
await downloadCliToResources()
