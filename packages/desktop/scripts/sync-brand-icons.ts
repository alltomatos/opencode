import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"

const brandLogoPath = resolve("packages/ui/src/assets/images/brand-logo.png")
const pngBuf = readFileSync(brandLogoPath)

function createIcoFromPng(pngBuffer: Buffer): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // ICO type
  header.writeUInt16LE(1, 4) // 1 image

  const dirEntry = Buffer.alloc(16)
  dirEntry.writeUInt8(0, 0) // width (0 = 256)
  dirEntry.writeUInt8(0, 1) // height (0 = 256)
  dirEntry.writeUInt8(0, 2) // palette colors
  dirEntry.writeUInt8(0, 3) // reserved
  dirEntry.writeUInt16LE(1, 4) // color planes
  dirEntry.writeUInt16LE(32, 6) // bpp
  dirEntry.writeUInt32LE(pngBuffer.length, 8) // image size
  dirEntry.writeUInt32LE(22, 12) // image offset (6 + 16)

  return Buffer.concat([header, dirEntry, pngBuffer])
}

const icoBuf = createIcoFromPng(pngBuf)

const channels = ["prod", "dev", "beta"]
const pngNames = [
  "icon.png",
  "dock.png",
  "StoreLogo.png",
  "Square89x89Logo.png",
  "Square71x71Logo.png",
  "Square44x44Logo.png",
  "Square310x310Logo.png",
  "Square30x30Logo.png",
  "Square284x284Logo.png",
  "Square150x150Logo.png",
  "Square142x142Logo.png",
  "Square107x107Logo.png",
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "256x256.png",
  "512x512.png",
]

const targets: { path: string; data: Buffer }[] = []

for (const ch of channels) {
  targets.push({ path: `packages/desktop/icons/${ch}/icon.ico`, data: icoBuf })
  for (const name of pngNames) {
    targets.push({ path: `packages/desktop/icons/${ch}/${name}`, data: pngBuf })
  }
}

// Resources icons
targets.push({ path: "packages/desktop/resources/icons/icon.ico", data: icoBuf })
for (const name of pngNames) {
  targets.push({ path: `packages/desktop/resources/icons/${name}`, data: pngBuf })
}

// UI assets favicon (real binary files)
targets.push(
  { path: "packages/ui/src/assets/favicon/favicon.ico", data: icoBuf },
  { path: "packages/ui/src/assets/favicon/favicon-v3.ico", data: icoBuf },
  { path: "packages/ui/src/assets/favicon/favicon-96x96.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/favicon-96x96-v3.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/apple-touch-icon.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/apple-touch-icon-v3.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/web-app-manifest-192x192.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/web-app-manifest-512x512.png", data: pngBuf },
)

for (const target of targets) {
  const fullPath = resolve(target.path)
  const dir = dirname(fullPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(fullPath, target.data)
  console.log(`Updated: ${target.path}`)
}

console.log("All brand icons synchronized successfully.")
