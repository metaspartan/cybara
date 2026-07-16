import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("standalone CLI smoke script", () => {
  test("waits for daemon readiness and preserves failure diagnostics", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "scripts", "smoke-standalone-cli.sh"),
      "utf8"
    );

    expect(source).toContain("for attempt in {1..15}");
    expect(source).toContain('if "$BINARY" status');
    expect(source).toContain('"$BINARY" daemon-logs || true');
    expect(source).toContain('"$BINARY" stop || true');
  });
});
