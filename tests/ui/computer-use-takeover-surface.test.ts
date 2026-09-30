import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const overlaySource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ComputerUseTakeoverOverlay.tsx", import.meta.url)),
  "utf8"
);

describe("computer use takeover surface", () => {
  test("covers the full viewport instead of a thin top bar", () => {
    expect(overlaySource).toContain('"computer-use-takeover-surface"');
    expect(overlaySource).toMatch(/fixed inset-0/);
    expect(overlaySource).not.toMatch(/pointer-events-none fixed inset-x-0 top-0/);
  });

  test("states the takeover in the user's own words", () => {
    expect(overlaySource).toContain("Cybara is using your computer");
  });

  test("offers an explicit stop affordance that ends the turn", () => {
    expect(overlaySource).toContain('data-testid="computer-use-stop"');
    expect(overlaySource).toMatch(/Stop/);
  });

  test("is announced to assistive technology as a takeover dialog", () => {
    expect(overlaySource).toMatch(/role="dialog"/);
    expect(overlaySource).toMatch(/aria-modal="true"/);
  });

  test("shows elapsed time and the app being driven", () => {
    expect(overlaySource).toMatch(/elapsed/i);
    expect(overlaySource).toMatch(/takeover\.app/);
  });

  test("never tells the user Cybara paused or yielded", () => {
    expect(overlaySource).not.toMatch(/paused so it does not fight you/i);
    expect(overlaySource).not.toMatch(/You took control/);
  });
});
