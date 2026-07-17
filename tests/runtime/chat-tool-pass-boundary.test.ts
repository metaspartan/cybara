import { describe, expect, test } from "bun:test";
import { readChatRuntimeSource } from "../source-fixtures";

describe("chat tool pass boundary", () => {
  test("does not start another tool-capable model loop after a completed response", () => {
    const source = readChatRuntimeSource();

    expect(source).not.toContain("If more actions are needed to fully complete");
    expect(source).not.toContain("summaryToolPolicy");
    expect(source).toContain("if (!responseContent.trim())");
    expect(source).toContain("Answer the user from these results. Do not call tools.");
  });
});
