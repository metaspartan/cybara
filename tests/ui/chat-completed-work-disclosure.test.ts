import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("completed chat work disclosure parity", () => {
  test("web and Tauri collapse persisted work under the elapsed summary", () => {
    const timeline = source("ui/src/pages/chat/ActivityTimeline.tsx");
    const chat = source("ui/src/pages/Chat.tsx");
    const assistantMeta = source("ui/src/pages/chat/AssistantMetaInline.tsx");

    expect(timeline).toContain("export function CompletedActivityTimeline");
    expect(timeline).toContain("const [expanded, setExpanded] = useState(false)");
    expect(timeline).toContain("aria-expanded={expanded}");
    expect(timeline).toContain('<ChevronDown className="h-3 w-3 shrink-0 text-current" />');
    expect(timeline).toContain('<ChevronRight className="h-3 w-3 shrink-0 text-current" />');
    expect(timeline).toContain("<ProcessActivityList activities={visibleActivities} />");
    expect(assistantMeta).toContain("<CompletedActivityTimeline");
    expect(assistantMeta).toContain('t("chat.workedFor", {');
    expect(chat).not.toContain("hasAssistantToolCalls");
  });

  test("mobile keeps live work open and completed work collapsed", () => {
    const chat = source("apps/mobile/src/screens/dashboardChat.tsx");

    expect(chat).toContain("live = false");
    expect(chat).toContain("const [expanded, setExpanded] = useState(live)");
    expect(chat).toContain("setExpanded(live)");
    expect(chat).toContain("Working for {timeline.workedDuration}");
    expect(chat).toContain("Worked for {timeline.workedDuration}");
    expect(chat).toContain("{live || expanded ? (");
    expect(chat).toContain("accessibilityState={{ expanded }}");
    expect(chat).toContain("<ChevronDown color={colors.textMuted} size={13} strokeWidth={2.2} />");
    expect(chat).toContain("<ChevronRight color={colors.textMuted} size={13} strokeWidth={2.2} />");
  });

  test("native macOS uses a collapsed completed disclosure and an expanded live timeline", () => {
    const completed = source("apps/macos/Cybara/Sources/Cybara/NativeToolTimeline.swift");

    expect(completed).toContain("@State private var expanded = false");
    expect(completed).toContain("nativeWorkedDurationLabel(for: message)");
    expect(completed).toContain('expanded ? "chevron.down" : "chevron.right"');
    expect(completed).toContain("if expanded {");
    expect(completed).toContain("NativeLiveToolTimelineView");
    expect(completed).toContain("nativeLiveWorkedDurationLabel(startedAt:");
  });

  test("TUI collapses completed work and leaves active runs visible", () => {
    const tui = source("src/cli-tui-interactive-chat.tsx");

    expect(tui).toContain(
      "const [expandedActivities, setExpandedActivities] = React.useState(false)"
    );
    expect(tui).toContain('{live ? "◌" : expanded ? "▾" : "▸"}');
    expect(tui).toContain("{live || expanded");
    expect(tui).toContain('normalizedCommand === "details"');
    expect(tui).toContain("expandedActivities={expandedActivities}");
  });
});
