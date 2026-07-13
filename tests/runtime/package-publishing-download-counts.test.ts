import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("package publishing release asset accounting", () => {
  test("uses release digest metadata without downloading published binaries", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "publish-packages.yml"),
      "utf8"
    );

    expect(workflow).toContain(".digest");
    expect(workflow).toContain("gh api");
    expect(workflow).not.toContain("updpkgsums: true");
    expect(workflow).not.toContain('curl -fL "$base/$1"');
    expect(workflow).not.toContain('curl -fsSL "$base/$1.sha256"');
  });
});
