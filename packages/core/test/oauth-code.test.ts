import { describe, expect, it } from "bun:test"
import { extractOAuthCode } from "../src/oauth/code"

describe("extractOAuthCode", () => {
  it("extracts code from full loopback redirect URL", () => {
    const url = "http://127.0.0.1:42205/oauth2callback?state=l5i3DbP7rV2kO0S7w19bEg&code=4%2F0Aean50b...&scope=email+profile"
    expect(extractOAuthCode(url)).toBe("4/0Aean50b...")

    const userUrl = "http://127.0.0.1:37441/oauth2callback?state=sIBNtwli6V66Ovcr5sySHQ&iss=https://accounts.google.com&code=4/0ATsMZqAPUtI0zyxENRAK2fh4Bn5pnL0ERFhRMh0p2Ybc0u35jEulq0omLrIaKd5pJiMiXg&scope=email%20profile%20https://www.googleapis.com/auth/cloud-platform%20https://www.googleapis.com/auth/userinfo.email%20https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/cclog%20https://www.googleapis.com/auth/experimentsandconfigs%20openid&authuser=0&prompt=consent"
    expect(extractOAuthCode(userUrl)).toBe("4/0ATsMZqAPUtI0zyxENRAK2fh4Bn5pnL0ERFhRMh0p2Ybc0u35jEulq0omLrIaKd5pJiMiXg")
  })

  it("extracts code from localhost callback URL", () => {
    const url = "http://localhost:1455/auth/callback?code=def_code123&state=state_abc"
    expect(extractOAuthCode(url)).toBe("def_code123")
  })

  it("extracts code from url without protocol", () => {
    const url = "127.0.0.1:42205/oauth2callback?code=my_code_456"
    expect(extractOAuthCode(url)).toBe("my_code_456")
  })

  it("extracts code from query string fragment", () => {
    expect(extractOAuthCode("code=sample_code_789&state=xyz")).toBe("sample_code_789")
    expect(extractOAuthCode("?code=sample_code_789")).toBe("sample_code_789")
  })

  it("returns raw code if plain string provided", () => {
    expect(extractOAuthCode("4/0Aean50b12345")).toBe("4/0Aean50b12345")
    expect(extractOAuthCode("  raw_token_code  ")).toBe("raw_token_code")
  })

  it("handles empty input safely", () => {
    expect(extractOAuthCode("")).toBe("")
    expect(extractOAuthCode("   ")).toBe("")
  })
})
