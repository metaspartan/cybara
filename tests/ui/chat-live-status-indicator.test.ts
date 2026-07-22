import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
}

describe("live chat status indicator", () => {
  test("maps thinking to composing and response generation to solving", () => {
    const indicator = source("ui/src/pages/chat/LiveStatusIndicator.tsx");

    expect(indicator).toContain('text === "Generating response..." ? "solving" : "composing"');
    expect(indicator).toContain("const orbState = resolveLiveStatusOrbState(text)");
    expect(indicator).toContain("state={orbState}");
    expect(indicator).toContain("data-orb-state={orbState}");
  });

  test("renders the orb as a decorative fixed-size canvas", () => {
    const indicator = source("ui/src/pages/chat/LiveStatusIndicator.tsx");

    expect(indicator).toContain("size={20}");
    expect(indicator).toContain("width={20}");
    expect(indicator).toContain("height={20}");
    expect(indicator).toContain('role="presentation"');
    expect(indicator).toContain('aria-hidden="true"');
    expect(indicator).toContain("live-status-shine");
    expect(indicator).toContain("items-center");
    expect(indicator).not.toContain("items-start");
  });

  test("shares the indicator across main, multi-chat, and IDE timelines", () => {
    const chatTimeline = source("ui/src/pages/chat/ActivityTimeline.tsx");
    const ideTimeline = source("ui/src/pages/ide/IdeActivityTimeline.tsx");

    expect(chatTimeline).toContain("<LiveStatusIndicator");
    expect(ideTimeline).toContain("<LiveStatusIndicator");
  });

  test("uses theme tokens and disables text animation for reduced motion", () => {
    const styles = source("ui/src/styles/index-foundation.css");

    expect(styles).toContain(".live-status-shine");
    expect(styles).toContain("var(--text-muted)");
    expect(styles).toContain("var(--text-primary)");
    expect(styles).toContain("var(--live-status-highlight)");
    expect(styles).toContain("html.light .live-status-shine");
    expect(styles).toContain("@keyframes live-status-text-shine");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.live-status-shine[\s\S]*-webkit-text-fill-color: currentColor/
    );
  });
});
