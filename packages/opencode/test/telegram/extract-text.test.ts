import { describe, expect, test } from "bun:test"
import { extractText } from "../../src/telegram"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

function withParts(parts: SessionV1.WithParts["parts"]): SessionV1.WithParts {
  return {
    info: {
      id: "msg_test" as SessionV1.WithParts["info"]["id"],
      role: "assistant",
    } as SessionV1.WithParts["info"],
    parts,
  }
}

describe("Telegram.extractText", () => {
  test("joins text parts with newlines", () => {
    const result = withParts([
      { type: "text", text: "first" } as SessionV1.TextPart,
      { type: "text", text: "second" } as SessionV1.TextPart,
    ])
    expect(extractText(result)).toBe("first\nsecond")
  })

  test("ignores non-text parts", () => {
    const result = withParts([
      { type: "text", text: "hello" } as SessionV1.TextPart,
      { type: "step-start" } as unknown as SessionV1.WithParts["parts"][number],
    ])
    expect(extractText(result)).toBe("hello")
  })

  test("returns an empty string when there are no text parts", () => {
    const result = withParts([{ type: "step-start" } as unknown as SessionV1.WithParts["parts"][number]])
    expect(extractText(result)).toBe("")
  })

  test("trims surrounding whitespace", () => {
    const result = withParts([{ type: "text", text: "  padded  " } as SessionV1.TextPart])
    expect(extractText(result)).toBe("padded")
  })
})
