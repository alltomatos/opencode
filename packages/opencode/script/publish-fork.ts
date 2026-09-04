#!/usr/bin/env bun
// Publishes this fork's own CLI to npm under its own scope (default
// @alltomatos), separate from upstream's `opencode-ai`/`@opencode-ai/*`
// packages — those are published only from anomalyco/opencode (see
// script/publish.ts, guarded in .github/workflows/publish.yml). This is the
// fork-specific counterpart, driven by dist/ output from
// packages/opencode/script/build.ts.
//
// Requires (as env vars): OPENCODE_VERSION, NPM_TAG ("dev" or "latest"),
// and an npm auth token available to `npm publish` (e.g. via .npmrc set up
// by actions/setup-node + secrets.NPM_TOKEN in CI). Optional: NPM_SCOPE
// (defaults to "@alltomatos").

import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const SCOPE = process.env.NPM_SCOPE ?? "@alltomatos"
const TAG = process.env.NPM_TAG ?? "dev"
const VERSION = process.env.OPENCODE_VERSION
if (!VERSION) throw new Error("OPENCODE_VERSION is required")

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(distDir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(distDir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await $`bun pm pack`.cwd(distDir)
  await $`npm publish *.tgz --access public --tag ${TAG}`.cwd(distDir)
}

// Re-scope each per-platform binary package build.ts produced unscoped
// (dist/opencode-<platform>-<arch>/package.json, name "opencode-<...>") and
// collect them as the wrapper's optionalDependencies.
const binaries: Record<string, string> = {}
const platformDirs: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const platformDir = filepath.split("/")[0]!
  const pkgPath = `./dist/${platformDir}/package.json`
  const pkg = await Bun.file(pkgPath).json()
  const scopedName = `${SCOPE}/${pkg.name}`
  pkg.name = scopedName
  pkg.version = VERSION
  await Bun.file(pkgPath).write(JSON.stringify(pkg, null, 2))
  binaries[scopedName] = VERSION
  platformDirs[scopedName] = platformDir
}
console.log("binaries", binaries)

const wrapperName = `${SCOPE}/opencode`
const wrapperDir = "./dist/opencode-wrapper"
await $`mkdir -p ${wrapperDir}/bin`
await $`cp ./script/postinstall.mjs ${wrapperDir}/postinstall.mjs`
await Bun.file(`${wrapperDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${wrapperDir}/bin/opencode.exe`).write(
  [
    `echo "Error: ${wrapperName}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${wrapperName} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${wrapperName} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)
await Bun.file(`${wrapperDir}/package.json`).write(
  JSON.stringify(
    {
      name: wrapperName,
      bin: { opencode: "./bin/opencode.exe" },
      scripts: { postinstall: "node ./postinstall.mjs" },
      version: VERSION,
      license: "MIT",
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tasks = Object.entries(binaries).map(([name]) => publish(`./dist/${platformDirs[name]}`, name, binaries[name]))
await Promise.all(tasks)
await publish(wrapperDir, wrapperName, VERSION)

console.log(`published ${wrapperName}@${VERSION} (tag: ${TAG})`)
