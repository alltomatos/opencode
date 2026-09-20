export function extractOAuthCode(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ""

  try {
    const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(`http://${trimmed}`)
    const code = url.searchParams.get("code")
    if (code) return decodeURIComponent(code)
  } catch {}

  if (trimmed.includes("code=")) {
    const match = trimmed.match(/[?&]?code=([^&\s#]+)/)
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1])
      } catch {
        return match[1]
      }
    }
  }

  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}
