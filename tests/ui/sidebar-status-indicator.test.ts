import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { readUiStylesSource } from "../shared/source-bundles";

const sidebarPath = fileURLToPath(
  new URL("../../ui/src/components/layout/Sidebar.tsx", import.meta.url)
);
const activeSessionTrackerPath = fileURLToPath(
  new URL("../../ui/src/components/layout/activeSessionTracker.ts", import.meta.url)
);
const sidebarAgentStatusPath = fileURLToPath(
  new URL("../../ui/src/components/layout/useSidebarAgentStatus.ts", import.meta.url)
);
const logoPath = fileURLToPath(new URL("../../ui/public/cybara.png", import.meta.url));
const thinkingLogoPath = fileURLToPath(
  new URL("../../ui/public/cybara-thinking.png", import.meta.url)
);

function readSidebarSource(): string {
  return readFileSync(sidebarPath, "utf8");
}

describe("Sidebar status indicator behavior", () => {
  test("keeps chat history in the main sidebar and Sessions in More", () => {
    const source = readSidebarSource();

    expect(source).toContain("const sidebarDestinations");
    expect(source).toContain("navigate(buildFreshChatPath())");
    expect(source).toContain(
      '{ path: "/sessions", icon: MessagesSquare, labelKey: "nav.sessions" }'
    );
    expect(source).toContain("<SessionsPanel");
    expect(source).toContain('placement="main"');
    expect(source).not.toContain('id: "developer"');
  });

  test("treats every in-turn status event as activity so the indicator never flickers", () => {
    const source = readSidebarSource();
    const tracker = readFileSync(activeSessionTrackerPath, "utf8");
    const statusHook = readFileSync(sidebarAgentStatusPath, "utf8");

    for (const status of [
      "thinking",
      "generating",
      "tool_executing",
      "tool_completed",
      "compacting",
    ]) {
      expect(tracker).toContain(`"${status}"`);
    }
    expect(statusHook).toContain("SIDEBAR_ACTIVE_STATUSES.has(data.status)");
    expect(statusHook).toContain('data.type === "task_completed"');
    expect(statusHook).toMatch(
      /setStatus\(globalActive \|\| hasActiveSessions \? ["']active["'] : ["']idle["']\)/
    );
    expect(tracker).toContain('"error"');
    expect(statusHook).toContain("const runEnded = isRunEndingStatus(data);");
    expect(statusHook).toContain("} else if (runEnded) {");
    expect(statusHook).toContain("globalLastSeenRef.current = 0");
    expect(statusHook).toContain("chatApi.getSessionStatus()");
    expect(statusHook).toContain("reconcileAuthoritativeActiveSessions(");
    expect(statusHook).not.toContain("pruneInactiveSessions");
  });

  test("renders the shared two-frame thinking mark instead of a halo ring", () => {
    const source = readSidebarSource();
    const mark = readFileSync(
      fileURLToPath(new URL("../../ui/src/components/CybaraThinkingMark.tsx", import.meta.url)),
      "utf8"
    );
    const css = readUiStylesSource();

    expect(source).toMatch(/status === ["']active["']/);
    expect(source).not.toContain("ring-2 ring-amber-400/60");
    expect(source).toContain('src="/cybara.png"');
    expect(source).toContain('status === "active" && "opacity-0"');
    expect(source).toContain("<CybaraThinkingMark />");
    expect(mark).toContain('from "../../public/cybara.png"');
    expect(mark).toContain('from "../../public/cybara-thinking.png"');
    expect(css).toContain(".cybara-thinking-mark");
    expect(css).not.toContain(".gif");
    expect(css).toContain("inset: 0");
    expect(css).toContain("width: 100%");
    expect(css).toContain("height: 100%");
    expect(css).toContain("steps(1, end)");
    expect(css).toContain("object-fit: contain");
    expect(css).not.toContain("cybara-thinking-sprite");
    expect(css).not.toContain('url("/cybara-thinking-sprite.png")');
  });

  test("thinking frames use square canvases and matching visible proportions", () => {
    const logo = PNG.sync.read(readFileSync(logoPath));
    const thinking = PNG.sync.read(readFileSync(thinkingLogoPath));
    const visibleBounds = (
      png: PNG
    ): { top: number; bottom: number; height: number; center: number } => {
      let top = png.height;
      let bottom = -1;
      for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
          if (png.data[(y * png.width + x) * 4 + 3] > 8) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      return {
        top,
        bottom,
        height: bottom - top + 1,
        center: (top + bottom) / 2,
      };
    };

    expect(logo.width).toBe(logo.height);
    expect(thinking.width).toBe(thinking.height);
    const logoBounds = visibleBounds(logo);
    const thinkingBounds = visibleBounds(thinking);
    const logoHeightRatio = logoBounds.height / logo.height;
    const thinkingHeightRatio = thinkingBounds.height / thinking.height;
    const logoCenterRatio = logoBounds.center / logo.height;
    const thinkingCenterRatio = thinkingBounds.center / thinking.height;
    expect(Math.abs(thinkingHeightRatio - logoHeightRatio)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(thinkingCenterRatio - logoCenterRatio)).toBeLessThanOrEqual(0.01);
  });
});
