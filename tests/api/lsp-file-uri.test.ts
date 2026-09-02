import { describe, expect, test } from "bun:test";
import { normalizeFileUriToPath } from "../../src/api/routes/lsp-ide";

describe("LSP file URI normalization", () => {
  test("decodes escaped characters in workspace diagnostic paths", () => {
    expect(normalizeFileUriToPath("file:///tmp/project%20name/src/index.ts")).toBe(
      "/tmp/project name/src/index.ts"
    );
  });

  test("leaves ordinary paths unchanged", () => {
    expect(normalizeFileUriToPath("/tmp/project/src/index.ts")).toBe("/tmp/project/src/index.ts");
  });
});
