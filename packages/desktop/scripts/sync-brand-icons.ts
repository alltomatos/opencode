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

const targets = [
  // Desktop channels
  { path: "packages/desktop/icons/prod/icon.png", data: pngBuf },
  { path: "packages/desktop/icons/prod/dock.png", data: pngBuf },
  { path: "packages/desktop/icons/prod/icon.ico", data: icoBuf },
  { path: "packages/desktop/icons/dev/icon.png", data: pngBuf },
  { path: "packages/desktop/icons/dev/dock.png", data: pngBuf },
  { path: "packages/desktop/icons/dev/icon.ico", data: icoBuf },
  { path: "packages/desktop/icons/beta/icon.png", data: pngBuf },
  { path: "packages/desktop/icons/beta/dock.png", data: pngBuf },
  { path: "packages/desktop/icons/beta/icon.ico", data: icoBuf },
  { path: "packages/desktop/resources/icons/icon.png", data: pngBuf },
  { path: "packages/desktop/resources/icons/dock.png", data: pngBuf },
  { path: "packages/desktop/resources/icons/icon.ico", data: icoBuf },

  // Web app public
  { path: "packages/app/public/favicon.ico", data: icoBuf },
  { path: "packages/app/public/favicon-v3.ico", data: icoBuf },
  { path: "packages/app/public/favicon-96x96.png", data: pngBuf },
  { path: "packages/app/public/favicon-96x96-v3.png", data: pngBuf },
  { path: "packages/app/public/apple-touch-icon.png", data: pngBuf },
  { path: "packages/app/public/apple-touch-icon-v3.png", data: pngBuf },

  // UI assets favicon
  { path: "packages/ui/src/assets/favicon/favicon.ico", data: icoBuf },
  { path: "packages/ui/src/assets/favicon/favicon-v3.ico", data: icoBuf },
  { path: "packages/ui/src/assets/favicon/favicon-96x96.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/favicon-96x96-v3.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/apple-touch-icon.png", data: pngBuf },
  { path: "packages/ui/src/assets/favicon/apple-touch-icon-v3.png", data: pngBuf },
]

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
