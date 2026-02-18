import { describe, expect, test } from "bun:test";
import { getDangerousToolNames, isDangerousTool } from "../../src/core/tools/index";

describe("Dangerous tool classification", () => {
  test("marks high-impact tools as dangerous", () => {
    expect(isDangerousTool("exec")).toBe(true);
    expect(isDangerousTool("wallet")).toBe(true);
    expect(isDangerousTool("browser")).toBe(true);
  });

  test("keeps read-only helpers outside dangerous set", () => {
    expect(isDangerousTool("read")).toBe(false);
    expect(isDangerousTool("grep")).toBe(false);
  });

  test("dangerous tool list exposes known tool names", () => {
    const names = getDangerousToolNames();
    expect(names).toContain("exec");
    expect(names).toContain("wallet");
    expect(names).not.toContain("read");
  });
});
