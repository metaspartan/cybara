import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("subagent chat boundary", () => {
  test("keeps subagent lifecycle reports out of the parent transcript", () => {
    const source = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

    expect(source).not.toContain("onSubagentLifecycle");
    expect(source).not.toContain("[Subagent] Announced to requester session");
  });

  test("instructs the parent to retrieve and synthesize child results", () => {
    const source = readFileSync(join(process.cwd(), "src/core/tools/handlers/channel.ts"), "utf8");

    expect(source).toContain("parent retrieves it through sessions_wait");
    expect(source).not.toContain("delivers it to the requester automatically");
  });
});
