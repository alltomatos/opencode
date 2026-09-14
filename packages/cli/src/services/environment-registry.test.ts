import { describe, expect, test } from "bun:test"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import { makeWithDirectory } from "./environment-registry"

describe("EnvironmentRegistry", () => {
  test("adds, lists, gets, and removes environments", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-registry-test-"))

    try {
      const program = Effect.gen(function* () {
        const registry = yield* makeWithDirectory(tempDir)

        // Initially empty
        const initial = yield* registry.list()
        expect(initial).toEqual([])

        // Add an environment
        const env1 = yield* registry.add({
          name: "prod-vps",
          url: "http://192.168.1.100:4096",
          token: "secret-token-123",
          ssh: {
            host: "192.168.1.100",
            user: "root",
            port: 22,
          },
        })
        expect(env1.name).toBe("prod-vps")
        expect(env1.url).toBe("http://192.168.1.100:4096")
        expect(env1.id).toMatch(/^env_/)

        // Duplicate name fails
        const duplicateResult = yield* registry
          .add({ name: "prod-vps", url: "http://another.url" })
          .pipe(Effect.exit)
        expect(duplicateResult._tag).toBe("Failure")

        // Add a second environment
        const env2 = yield* registry.add({
          name: "staging-vps",
          url: "http://10.0.0.5:4096",
        })

        // List both
        const list = yield* registry.list()
        expect(list.length).toBe(2)

        // Get by name and ID
        const fetchedByName = yield* registry.get("prod-vps")
        expect(fetchedByName?.id).toBe(env1.id)

        const fetchedById = yield* registry.get(env2.id)
        expect(fetchedById?.name).toBe("staging-vps")

        // Persistence check: new instance reading same directory
        const registry2 = yield* makeWithDirectory(tempDir)
        const list2 = yield* registry2.list()
        expect(list2.length).toBe(2)

        // Remove by name
        const removed = yield* registry.rm("prod-vps")
        expect(removed).toBe(true)

        // Remove nonexistent
        const removedAgain = yield* registry.rm("prod-vps")
        expect(removedAgain).toBe(false)

        const afterRemove = yield* registry.list()
        expect(afterRemove.length).toBe(1)
        expect(afterRemove[0].name).toBe("staging-vps")
      }).pipe(
        Effect.provide(NodeServices.layer),
      )

      await Effect.runPromise(program)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
