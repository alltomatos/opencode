import type { SshServersState } from "@opencode-ai/app/ssh-tunnel/types"

export function readySshConnections(state?: SshServersState) {
  return (state?.servers ?? []).flatMap((item) => {
    if (item.runtime.kind !== "ready") return []
    return [
      {
        displayName: item.config.label ?? item.config.host,
        type: "ssh" as const,
        host: item.config.host,
        sshServerId: item.config.id,
        http: {
          url: item.runtime.url,
          username: item.runtime.username ?? undefined,
          password: item.runtime.password ?? undefined,
        },
      },
    ]
  })
}
