import { describe, expect, test } from "bun:test"
import { directoryPickerKind } from "./directory-picker-policy"

const local = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://localhost:4096" },
} as const
const remote = {
  type: "ssh",
  host: "example.test",
  sshServerId: "ssh:test",
  http: { url: "http://localhost:4096" },
} as const
const httpLocal = {
  type: "http",
  http: { url: "http://127.0.0.1:4096" },
} as const
const httpLocalhost = {
  type: "http",
  http: { url: "http://localhost:4096" },
} as const

describe("directoryPickerKind", () => {
  test("uses the native picker only for local desktop sidecar projects", () => {
    expect(directoryPickerKind("desktop", local)).toBe("native")
    expect(directoryPickerKind("desktop", remote)).toBe("server")
    expect(directoryPickerKind("desktop", httpLocal)).toBe("server")
    expect(directoryPickerKind("desktop", httpLocalhost)).toBe("server")
    expect(directoryPickerKind("web", local)).toBe("server")
    expect(directoryPickerKind("desktop", undefined)).toBe("server")
  })
})
