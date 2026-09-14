import { describe, expect, test } from "bun:test"
import { BranchSelectorV2 } from "./branch-selector-v2"

describe("BranchSelectorV2", () => {
  test("is defined and exported as a component", () => {
    expect(typeof BranchSelectorV2).toBe("function")
  })
})
