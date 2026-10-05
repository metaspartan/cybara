import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const source = readFileSync(
  join(import.meta.dir, "../../ui/src/pages/chat/ComputerUseTakeoverOverlay.tsx"),
  "utf8"
);
test("computer-use notice is compact, non-modal and dismissible", () => {
  expect(source).not.toContain("inset-0");
  expect(source).not.toContain("backdrop-blur");
  expect(source).not.toContain('aria-modal="true"');
  expect(source).not.toContain('role="dialog"');
  expect(source).toContain("max-w-sm");
  expect(source).toContain('role="status"');
  expect(source).toContain("Cybara is using your computer");
  expect(source).toContain('aria-label="Dismiss computer use notice"');
  expect(source).toContain('data-testid="computer-use-stop"');
});
test("notice scopes cancellation to its own session/run and does not hijack global Escape", () => {
  expect(source).toContain("dismissedScope === scope");
  expect(source).toContain("controller.signal.aborted");
  expect(source).toContain("data?.sessionId === sessionId");
  expect(source).not.toContain('window.addEventListener("keydown"');
  expect(source).not.toContain("IDLE_HIDE_MS");
});
test("notice is movable by pointer and keyboard and stays inside the viewport", () => {
  expect(source).toContain('data-testid="computer-use-drag-handle"');
  expect(source).toContain("onPointerDown");
  expect(source).toContain("setPointerCapture");
  expect(source).toContain("ArrowLeft");
  expect(source).toContain("ArrowRight");
  expect(source).toContain("clampToViewport");
  expect(source).toContain("cybara:computer-use-notice-position");
  expect(source).toContain("localStorage");
  expect(source).toContain('window.addEventListener("resize"');
  expect(source).toContain('window.removeEventListener("resize"');
  expect(source).toContain("onDoubleClick");
  expect(source).not.toContain("inset-0");
});
