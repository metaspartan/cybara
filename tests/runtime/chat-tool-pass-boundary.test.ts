import { describe, expect, test } from "bun:test";
import { readChatRuntimeSource } from "../source-fixtures";

describe("chat tool pass boundary", () => {
  test("does not start another tool-capable model loop after a completed response", () => {
    const source = readChatRuntimeSource();

    expect(source).not.toContain("If more actions are needed to fully complete");
    expect(source).not.toContain("summaryToolPolicy");
    expect(source).toContain("if (options.responseContent.trim()) return options.responseContent");
    expect(source).toContain("Write the final user-facing response for the latest request");
    expect(source).toContain("useTools: false");
  });
});
