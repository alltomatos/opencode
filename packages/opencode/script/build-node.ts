#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

await Bun.build({
  target: "node",
  // Bun's bundler resolves package.json "imports" conditions (e.g. `#sqlite`/`#pty`/`#fff`
  // in packages/core/package.json) using its own default condition set, which keeps "bun"
  // active regardless of `target`. Restrict conditions to "node" so these conditional
  // subpath imports resolve to their `.node.ts` variant instead of the `.bun.ts` one
  // (whose `bun:sqlite`/`bun-pty` -> `bun:ffi` imports crash Node's ESM loader with
  // ERR_UNSUPPORTED_ESM_URL_SCHEME when this bundle is loaded under Electron's
  // Node-based main/utility process).
  conditions: ["node"],
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    OPENCODE_MODELS_DEV: generated.modelsData,
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

console.log("Build complete")
