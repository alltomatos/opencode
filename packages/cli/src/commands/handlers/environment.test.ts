import { describe, expect, test } from "bun:test"
import { Commands } from "../commands"

describe("environment commands spec", () => {
  test("defines environment spec with add, list, rm subcommands", () => {
    expect(Commands.commands.environment).toBeDefined()
    expect(Commands.commands.environment.commands.add).toBeDefined()
    expect(Commands.commands.environment.commands.list).toBeDefined()
    expect(Commands.commands.environment.commands.rm).toBeDefined()
  })
})
