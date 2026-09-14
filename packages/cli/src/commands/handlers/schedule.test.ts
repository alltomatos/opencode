import { describe, expect, test } from "bun:test"
import { Commands } from "../commands"

describe("schedule commands spec", () => {
  test("defines schedule spec with add, list, rm subcommands", () => {
    expect(Commands.commands.schedule).toBeDefined()
    expect(Commands.commands.schedule.commands.add).toBeDefined()
    expect(Commands.commands.schedule.commands.list).toBeDefined()
    expect(Commands.commands.schedule.commands.rm).toBeDefined()
  })
})
