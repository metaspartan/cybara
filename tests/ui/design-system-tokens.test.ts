import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("index.css design-system utilities", () => {
  const css = read("../../ui/src/index.css");

  test("defines the glass utilities that shared primitives reference", () => {
    // These were used by TextArea / GlassButton / GlassCard / Button but defined
    // nowhere, so those primitives rendered unstyled.
    expect(css).toContain(".glass-input");
    expect(css).toContain(".glass-button-primary");
    expect(css).toContain(".glass-card-hover");
    expect(css).toContain("@keyframes glow-pulse");
    expect(css).toContain(".glow-pulse");
    // They should be built on the accent token, not hardcoded colors.
    expect(css).toMatch(/\.glass-button-primary\s*\{[^}]*var\(--accent-primary\)/);
  });

  test("keyboard focus uses a visible accent outline, not the old 1px white ring", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid rgb\(var\(--accent-primary\)\)/);
    // The suppressive `outline: none !important` global rule is gone.
    expect(css).not.toContain("outline: none !important");
  });

  test("honors prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("Sidebar keyboard focus is not suppressed", () => {
  const src = read("../../ui/src/components/layout/Sidebar.tsx");

  test("nav items no longer stack !outline-none / focus-visible:!outline-none", () => {
    expect(src).not.toContain("!outline-none");
    expect(src).not.toContain("focus-visible:!outline-none");
  });
});
