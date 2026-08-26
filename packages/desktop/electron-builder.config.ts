import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "opencode-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    // Notarization needs an Apple Developer account/API key, which this fork
    // doesn't have configured. Only notarize when those creds are present
    // (e.g. a future CI run with secrets); unsigned builds still install
    // fine, they just show a Gatekeeper warning the user has to click through.
    notarize: !!process.env.APPLE_API_KEY_ID,
    target: ["dmg", "zip"],
    // bun's flat/hoisted install keeps every optional native prebuild
    // (darwin-x64 *and* darwin-arm64 variants — @lydell/node-pty-darwin-*,
    // @msgpackr-extract/msgpackr-extract-darwin-*, and any other package
    // following the same "<name>-darwin-<arch>" convention) on disk
    // regardless of which arch electron-builder is currently packaging,
    // unlike npm, which prunes non-matching optionalDependencies.
    // @electron/universal then finds the same byte-identical file in both
    // the x64 and arm64 temp app bundles and refuses to merge them one
    // package at a time — matched node-pty first, then hit the same thing
    // for msgpackr-extract — so this covers the whole naming convention
    // instead of allowlisting packages one at a time as more turn up.
    x64ArchFiles: "Contents/Resources/app.asar.unpacked/node_modules/**/*-darwin-*/**/*",
  },
  dmg: {
    sign: !!process.env.CSC_LINK,
  },
  protocols: {
    name: "OpenCode",
    schemes: ["opencode"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "OpenCode Dev",
        // Same repo as prod, separate electron-updater channel ("dev" instead
        // of "latest") — CI publishes here on every push to the dev branch so
        // testers can install this build and get auto-updates that track dev,
        // without touching the prod release feed at all.
        publish: { provider: "github", owner: "alltomatos", repo: "opencode", channel: "dev" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "OpenCode Beta",
        protocols: { name: "OpenCode Beta", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "OpenCode by Alltomatos",
        protocols: { name: "OpenCode", schemes: ["opencode"] },
        publish: { provider: "github", owner: "alltomatos", repo: "opencode", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
        rpm: { packageName: "opencode", fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
