import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../../ui/src/components/ui/Select.tsx", import.meta.url)),
  "utf8"
);

describe("shared select accessibility", () => {
  test("associates visual labels with generated or explicit select ids", () => {
    expect(source).toContain("const generatedId = useId()");
    expect(source).toContain("const selectId = id || generatedId");
    expect(source).toContain("htmlFor={selectId}");
    expect(source).toContain("id={selectId}");
  });
});
