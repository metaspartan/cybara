import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const overlaySource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ComputerUseTakeoverOverlay.tsx", import.meta.url)),
  "utf8"
);

describe("computer use takeover overlay", () => {
  test("parses the json envelope instead of reading data off the Response", () => {
    expect(overlaySource).toContain("await response.json()");
    expect(overlaySource).not.toMatch(/response as \{ data\?:/);
  });

  test("rejects a failed takeover poll instead of showing stale state", () => {
    expect(overlaySource).toContain("if (!response.ok) throw new Error");
  });

  test("renders the active and user-yielded copy", () => {
    expect(overlaySource).toContain("Cybara is using your computer");
    expect(overlaySource).toContain("takeover.reason");
    expect(overlaySource).toContain('data-testid="computer-use-takeover"');
  });
});
