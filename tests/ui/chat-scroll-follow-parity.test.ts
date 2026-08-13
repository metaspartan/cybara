import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAT_FOLLOW_THRESHOLD_PX,
  isChatNearBottom,
  shouldFollowChatBottom,
} from "../../shared/chat-scroll-follow";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("chat follow parity", () => {
  test("shared helper decides following from distance or an existing follow state", () => {
    const scrolledAway = { scrollTop: 500, clientHeight: 300, scrollHeight: 1000 };
    const nudgedUp = { scrollTop: 650, clientHeight: 300, scrollHeight: 1000 };

    expect(shouldFollowChatBottom(scrolledAway, false)).toBe(false);
    expect(shouldFollowChatBottom(scrolledAway, true)).toBe(true);
    expect(shouldFollowChatBottom(nudgedUp, false)).toBe(true);
    expect(isChatNearBottom(nudgedUp, CHAT_FOLLOW_THRESHOLD_PX)).toBe(true);
  });

  test("web reuses the shared module rather than its own thresholds", () => {
    const source = read("ui/src/pages/chat/chatScroll.ts");
    expect(source).toContain("shared/chat-scroll-follow");
    expect(source).not.toContain("= 96");
  });

  test("mobile only pins to the bottom while the reader is following", () => {
    const source = read("apps/mobile/src/screens/dashboardSessionDetail.tsx");
    expect(source).toContain("cybara-shared/chat-scroll-follow");
    expect(source).toContain("if (!followChatBottomRef.current) return;");
    expect(source).toContain("followChatBottomRef.current = isChatNearBottom(");
    expect(source).toContain("if (!chatScrollGestureActiveRef.current) return;");
    expect(source).toContain("onMomentumScrollEnd={(event) => {");
  });

  test("macos gates every transcript autoscroll on the follow state", () => {
    const source = read("apps/macos/Cybara/Sources/Cybara/NativeChatTranscript.swift");
    expect(source).toContain("followsChatBottom = distance <= chatFollowThresholdPoints");
    expect(source).toContain("guard followsChatBottom else { return }");
    expect(source).toContain("guard followsChatBottom, showWorkingTimeline else { return }");
    expect(source).not.toMatch(
      /onChange\(of: streamingContent\) \{ _, _ in\n\s+if showWorkingTimeline/
    );
  });

  test("macos follow threshold matches the shared one", () => {
    const source = read("apps/macos/Cybara/Sources/Cybara/NativeChatTranscript.swift");
    expect(source).toContain(`chatFollowThresholdPoints: CGFloat = ${CHAT_FOLLOW_THRESHOLD_PX}`);
  });
});
