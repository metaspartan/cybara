import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("chat tool pass boundary", () => {
  test("does not start another tool-capable model loop after a completed response", () => {
    const source = readFileSync(join(process.cwd(), "src/api/chat.ts"), "utf8");

    expect(source).not.toContain("If more actions are needed to fully complete");
    expect(source).not.toContain("summaryToolPolicy");
    expect(source).toContain("if (!responseContent.trim())");
    expect(source).toContain("Answer the user from these results. Do not call tools.");
  });
});
