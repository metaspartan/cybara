import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const sidebarPath = fileURLToPath(
  new URL("../../ui/src/components/layout/Sidebar.tsx", import.meta.url)
);
const thinkingSpritePath = fileURLToPath(
  new URL("../../ui/public/cybara-thinking-sprite.png", import.meta.url)
);

function readSidebarSource(): string {
  return readFileSync(sidebarPath, "utf8");
}

describe("Sidebar status indicator behavior", () => {
  test("keeps Sessions under Developer and leaves Chat as its own quick entry", () => {
    const source = readSidebarSource();
    const developerStart = source.indexOf('id: "developer"');
    const chatStart = source.indexOf('id: "chat"');
    const sessionsItem = source.indexOf(
      '{ path: "/sessions", icon: MessagesSquare, label: "Sessions" }'
    );
    const chatItem = source.indexOf('{ path: "/chat", icon: MessageSquare, label: "Chat" }');

    expect(developerStart).toBeGreaterThan(-1);
    expect(chatStart).toBeGreaterThan(developerStart);
    expect(sessionsItem).toBeGreaterThan(developerStart);
    expect(sessionsItem).toBeLessThan(chatStart);
    expect(chatItem).toBeGreaterThan(chatStart);
  });

  test("treats every in-turn status event as activity so the indicator never flickers", () => {
    const source = readSidebarSource();

    for (const status of ["thinking", "generating", "tool_executing", "compacting"]) {
      expect(source).toContain(`"${status}"`);
    }
    expect(source).not.toContain('"tool_completed",');
    expect(source).toContain('statusValue === "tool_completed"');
    expect(source).toContain('data.type === "task_completed"');
    expect(source).toMatch(
      /setStatus\(globalActive \|\| hasActiveSessions \? ["']active["'] : ["']idle["']\)/
    );
    expect(source).toContain("ACTIVE_WINDOW_MS = 60_000");
    expect(source).toContain("activeSessions.length === 0");
    expect(source).toContain("globalLastSeenRef.current = 0");
  });

  test("renders active thinking sprite instead of a halo ring", () => {
    const source = readSidebarSource();
    const css = readFileSync(
      fileURLToPath(new URL("../../ui/src/index.css", import.meta.url)),
      "utf8"
    );

    expect(source).toMatch(/status === ["']active["']/);
    expect(source).not.toContain("ring-2 ring-amber-400/60");
    expect(source).toContain('src="/cybara.png"');
    expect(source).toContain('status === "active" && "opacity-0"');
    expect(source).toContain("cybara-thinking-sprite");
    expect(css).toContain('url("/cybara-thinking-sprite.png")');
    expect(css).not.toContain(".gif");
    expect(css).toContain("width: 2.875rem");
    expect(css).toContain("height: 2.875rem");
    expect(css).toContain("background-size: 23rem 2.875rem");
    expect(css).toContain("background-position: -23rem 0");
    expect(css).not.toContain("background-size: 800% 100%");
  });

  test("thinking sprite contains a left-to-right animation sequence", () => {
    const png = PNG.sync.read(readFileSync(thinkingSpritePath));
    const frameSize = 96;
    const frameCount = 8;
    const hashes = new Set<string>();
    const centers: number[] = [];

    expect(png.width).toBe(frameSize * frameCount);
    expect(png.height).toBe(frameSize);

    for (let frame = 0; frame < frameCount; frame += 1) {
      let hash = 2166136261;
      let weightedX = 0;
      let pixels = 0;
      for (let y = 0; y < frameSize; y += 1) {
        for (let x = 0; x < frameSize; x += 1) {
          const index = (y * png.width + frame * frameSize + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            hash ^= png.data[index + channel];
            hash = Math.imul(hash, 16777619);
          }
          if (png.data[index + 3] > 20) {
            weightedX += x;
            pixels += 1;
          }
        }
      }
      hashes.add((hash >>> 0).toString(16));
      centers.push(weightedX / pixels);
    }

    expect(hashes.size).toBeGreaterThanOrEqual(5);
    expect(Math.min(...centers)).toBeLessThan(46);
    expect(Math.max(...centers)).toBeGreaterThan(50.5);
    expect(Math.max(...centers) - Math.min(...centers)).toBeGreaterThan(5);
  });
});
