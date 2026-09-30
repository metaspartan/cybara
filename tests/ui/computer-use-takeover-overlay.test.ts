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

  test("announces the takeover and routes stop through the caller's handler", () => {
    expect(overlaySource).toContain("Cybara is using your computer");
    expect(overlaySource).toContain("onStop");
    expect(overlaySource).toContain('data-testid="computer-use-stop"');
  });

  test("maps escape to stop so the surface is always escapable", () => {
    expect(overlaySource).toContain('event.key === "Escape"');
  });
});
