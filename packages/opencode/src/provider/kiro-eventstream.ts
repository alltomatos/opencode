// Pure AWS EventStream binary framing (ByteQueue, CRC32, frame parsing) for the
// Kiro / AWS CodeWhisperer streaming response. Ported from OmniRoute's
// open-sse/executors/kiro/eventstream.ts (verified against live CodeWhisperer
// traffic there) — kept dependency-free since this runtime never imports
// OmniRoute directly.

export type EventFrame = {
  headers: Record<string, string>
  payload: Record<string, unknown> | null
}

export const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

/** Byte-accumulating queue that supports peeking a big-endian uint32 and draining exact lengths across chunk boundaries. */
export class ByteQueue {
  private chunks: Uint8Array[] = []
  private headOffset = 0
  length = 0

  push(chunk: Uint8Array) {
    if (!(chunk instanceof Uint8Array) || chunk.length === 0) return
    this.chunks.push(chunk)
    this.length += chunk.length
  }

  peekUint32BE(offset = 0): number | null {
    if (this.length < offset + 4) return null
    let value = 0
    for (let i = 0; i < 4; i++) value = (value << 8) | this.byteAt(offset + i)
    return value >>> 0
  }

  read(length: number): Uint8Array | null {
    if (length < 0 || this.length < length) return null
    const output = new Uint8Array(length)
    let written = 0
    while (written < length) {
      const head = this.chunks[0]
      const available = head.length - this.headOffset
      const take = Math.min(available, length - written)
      output.set(head.subarray(this.headOffset, this.headOffset + take), written)
      written += take
      this.headOffset += take
      this.length -= take
      if (this.headOffset >= head.length) {
        this.chunks.shift()
        this.headOffset = 0
      }
    }
    return output
  }

  private byteAt(offset: number): number {
    let remaining = offset
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]
      const start = i === 0 ? this.headOffset : 0
      const available = chunk.length - start
      if (remaining < available) return chunk[start + remaining]
      remaining -= available
    }
    return 0
  }
}

const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC32_TABLE[i] = c >>> 0
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Parses one complete AWS EventStream frame (the bytes already sliced to
 * exactly `totalLength`, as read from a ByteQueue via peekUint32BE(0)).
 * Only the 8-byte prelude CRC is validated by default — the transport is TLS
 * and the trailing message CRC is O(frame bytes) per frame, which matters on
 * long generations; set KIRO_VERIFY_FULL_CRC=true to also check it.
 */
export function parseEventFrame(data: Uint8Array): EventFrame | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const headersLength = view.getUint32(4, false)
    const preludeCRC = view.getUint32(8, false)
    if (preludeCRC !== crc32(data.slice(0, 8))) return null

    if (process.env["KIRO_VERIFY_FULL_CRC"] === "true") {
      const messageCRC = view.getUint32(data.length - 4, false)
      if (messageCRC !== crc32(data.slice(0, data.length - 4))) return null
    }

    const headers: Record<string, string> = {}
    let offset = 12
    const headerEnd = 12 + headersLength
    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset]
      offset++
      if (offset + nameLen > data.length) break
      const name = TEXT_DECODER.decode(data.subarray(offset, offset + nameLen))
      offset += nameLen
      const headerType = data[offset]
      offset++
      if (headerType !== 7) break // 7 = string type; anything else we don't need
      const valueLen = (data[offset] << 8) | data[offset + 1]
      offset += 2
      if (offset + valueLen > data.length) break
      headers[name] = TEXT_DECODER.decode(data.subarray(offset, offset + valueLen))
      offset += valueLen
    }

    const payloadStart = 12 + headersLength
    const payloadEnd = data.length - 4
    let payload: Record<string, unknown> | null = null
    if (payloadEnd > payloadStart) {
      const payloadStr = TEXT_DECODER.decode(data.subarray(payloadStart, payloadEnd))
      if (payloadStr && payloadStr.trim()) {
        try {
          payload = JSON.parse(payloadStr)
        } catch {
          payload = { raw: payloadStr }
        }
      }
    }
    return { headers, payload }
  } catch {
    return null
  }
}
