import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { TranscriptLog } from "@opencode-ai/core/event/transcript-log"
import fs from "fs/promises"

describe("TranscriptLog", () => {
  it("appends and reads transcript lines atomically in JSONL without locking database", async () => {
    const aggregateID = `test_session_${Date.now()}`
    const entry1: TranscriptLog.TranscriptEntry = {
      id: "ev_1",
      aggregateID,
      seq: 1,
      type: "message.updated.1",
      data: { text: "Chunk 1" },
      timestamp: 1000,
    }

    const entry2: TranscriptLog.TranscriptEntry = {
      id: "ev_2",
      aggregateID,
      seq: 2,
      type: "message.updated.1",
      data: { text: "Chunk 1 + Chunk 2" },
      timestamp: 1010,
    }

    await Effect.runPromise(TranscriptLog.append(entry1))
    await Effect.runPromise(TranscriptLog.append(entry2))

    const lines = await Effect.runPromise(TranscriptLog.readLines(aggregateID))
    expect(lines.length).toBe(2)
    expect(lines[0].id).toBe("ev_1")
    expect(lines[1].id).toBe("ev_2")
    expect(lines[1].data).toEqual({ text: "Chunk 1 + Chunk 2" })

    // Limpar arquivo de teste
    const filePath = TranscriptLog.getTranscriptPath(aggregateID)
    await fs.unlink(filePath).catch(() => {})
  })

  it("skips corrupted lines cleanly without failing the entire transcript read", async () => {
    const aggregateID = `test_corrupt_${Date.now()}`
    const filePath = TranscriptLog.getTranscriptPath(aggregateID)
    await fs.mkdir(filePath.substring(0, filePath.lastIndexOf("\\")), { recursive: true })

    const validLine1 = JSON.stringify({ id: "1", aggregateID, seq: 1, type: "t", data: "ok1" })
    const corruptedLine = '{"id":"2", truncated_json_...'
    const validLine2 = JSON.stringify({ id: "3", aggregateID, seq: 3, type: "t", data: "ok2" })

    await fs.writeFile(filePath, `${validLine1}\n${corruptedLine}\n${validLine2}\n`, "utf8")

    const lines = await Effect.runPromise(TranscriptLog.readLines(aggregateID))
    expect(lines.length).toBe(2)
    expect(lines[0].id).toBe("1")
    expect(lines[1].id).toBe("3")

    await fs.unlink(filePath).catch(() => {})
  })
})
