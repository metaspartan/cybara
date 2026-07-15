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
    expect(timeline).toContain("Working for {formatWorkedDuration(now - validStart)}");
    expect(timeline).toContain('activity.toolName === "__steering"');
    expect(timeline).toContain("const [expanded, setExpanded] = useState(false)");
    expect(timeline).toContain("aria-expanded={expanded}");
    expect(timeline).toContain('<ChevronDown className="h-3 w-3 shrink-0 text-current" />');
    expect(timeline).toContain('<ChevronRight className="h-3 w-3 shrink-0 text-current" />');
    expect(timeline).toContain("<ProcessActivityList activities={steeringActivities} />");
    expect(timeline).toContain("<ProcessActivityList activities={workActivities} />");
    expect(timeline.indexOf("<ProcessActivityList activities={workActivities} />")).toBeLessThan(
      timeline.indexOf("<ProcessActivityList activities={steeringActivities} />")
    );
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
    expect(chat).toContain('activity.toolName === "__steering"');
    expect(chat).toContain("workActivities.length > 0 && (live || expanded)");
    expect(chat).toContain("accessibilityState={{ expanded }}");
    expect(chat.indexOf("Working for {timeline.workedDuration}")).toBeLessThan(
      chat.indexOf("steeringActivities.map")
    );
    expect(chat).toContain("<ChevronDown color={colors.textMuted} size={13} strokeWidth={2.2} />");
    expect(chat).toContain("<ChevronRight color={colors.textMuted} size={13} strokeWidth={2.2} />");
  });

  test("native macOS uses a collapsed completed disclosure and an expanded live timeline", () => {
    const completed = source("apps/macos/Cybara/Sources/Cybara/NativeToolTimeline.swift");

    expect(completed).toContain("@State private var expanded = false");
    expect(completed).toContain("nativeWorkedDurationLabel(for: message)");
    expect(completed).toContain('$0.toolName == "__steering"');
    expect(completed).toContain('expanded ? "chevron.down" : "chevron.right"');
    expect(completed).toContain("if hasWorkContent && expanded {");
    expect(completed).toContain("NativeLiveToolTimelineView");
    expect(completed).toContain("nativeLiveWorkedDurationLabel(startedAt:");
    expect(completed.indexOf("if hasWorkContent {")).toBeLessThan(
      completed.indexOf("if !steeringActivities.isEmpty {")
    );
  });

  test("TUI collapses completed work and leaves active runs visible", () => {
    const tui = source("src/cli-tui-interactive-chat.tsx");

    expect(tui).toContain(
      "const [expandedActivities, setExpandedActivities] = React.useState(false)"
    );
    expect(tui).toContain('{live ? "◌" : expanded ? "▾" : "▸"}');
    expect(tui).toContain('activity.toolName === "__steering"');
    expect(tui).toContain("rows.length > 0 && (live || expanded)");
    expect(tui).toContain('normalizedCommand === "details"');
    expect(tui).toContain("expandedActivities={expandedActivities}");
    expect(tui.indexOf('{live ? "Working" : "Worked"} for')).toBeLessThan(
      tui.indexOf("steeringActivities.map")
    );
  });
});
