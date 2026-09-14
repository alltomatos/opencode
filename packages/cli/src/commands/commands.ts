import { Argument, Flag } from "effect/unstable/cli"
import { Spec } from "../framework/spec"

declare const OPENCODE_CLI_NAME: string | undefined

export const Commands = Spec.make(typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode", {
  description: "OpenCode 2.0 preview command line interface",
  commands: [
    Spec.make("api", {
      description: "Make a request to the running server",
      params: {
        request: Argument.string("operation | method path").pipe(
          Argument.withDescription("OpenAPI operation ID, or an HTTP method followed by a path"),
          Argument.variadic({ min: 1, max: 2 }),
        ),
        data: Flag.string("data").pipe(Flag.withAlias("d"), Flag.withDescription("Request body"), Flag.optional),
        header: Flag.string("header").pipe(
          Flag.withAlias("H"),
          Flag.withDescription("Request header in name:value form"),
          Flag.atMost(100),
        ),
        param: Flag.keyValuePair("param").pipe(Flag.withDescription("OpenAPI path or query parameter"), Flag.optional),
      },
    }),
    Spec.make("debug", {
      description: "Debugging and troubleshooting tools",
      commands: [Spec.make("agents", { description: "List all agents" })],
    }),
    Spec.make("migrate", { description: "Migrate v1 data to v2" }),
    Spec.make("environment", {
      description: "Manage saved remote environments",
      commands: [
        Spec.make("add", {
          description: "Add a remote environment",
          params: {
            name: Argument.string("name").pipe(Argument.withDescription("Environment name")),
            url: Argument.string("url").pipe(Argument.withDescription("Environment base URL")),
            token: Flag.string("token").pipe(Flag.withAlias("t"), Flag.withDescription("Authentication token"), Flag.optional),
          },
        }),
        Spec.make("list", { description: "List saved environments" }),
        Spec.make("rm", {
          description: "Remove a saved environment",
          params: {
            idOrName: Argument.string("idOrName").pipe(Argument.withDescription("Environment ID or name")),
          },
        }),
      ],
    }),
    Spec.make("schedule", {
      description: "Manage scheduled automation tasks",
      commands: [
        Spec.make("add", {
          description: "Add a scheduled task",
          params: {
            cron: Argument.string("cron").pipe(Argument.withDescription("Cron expression (e.g. '*/5 * * * *')")),
            command: Argument.string("command").pipe(Argument.withDescription("Command to execute")),
            workspace: Flag.string("workspace").pipe(
              Flag.withAlias("w"),
              Flag.withDescription("Target workspace directory"),
              Flag.optional,
            ),
          },
        }),
        Spec.make("list", { description: "List scheduled tasks" }),
        Spec.make("rm", {
          description: "Remove a scheduled task",
          params: {
            id: Argument.string("id").pipe(Argument.withDescription("Schedule ID")),
          },
        }),
      ],
    }),
    Spec.make("service", {
      description: "Manage the background server",
      commands: [
        Spec.make("start", { description: "Start the background server" }),
        Spec.make("restart", { description: "Restart the background server" }),
        Spec.make("status", { description: "Show background server status" }),
        Spec.make("stop", { description: "Stop the background server" }),
        Spec.make("password", {
          description: "Get or set the server password",
          params: { value: Argument.string("value").pipe(Argument.optional) },
        }),
      ],
    }),
    Spec.make("serve", {
      description: "Start the v2 API server",
      params: {
        hostname: Flag.string("hostname").pipe(Flag.withDefault("127.0.0.1")),
        port: Flag.integer("port").pipe(Flag.optional),
        register: Flag.boolean("register").pipe(Flag.withDefault(false)),
      },
    }),
  ],
})
