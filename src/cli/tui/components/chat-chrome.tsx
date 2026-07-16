import React from "react";
import { Box, Text } from "ink";
import type { TuiContextUsage } from "../chat-environment";
import {
  resolveTuiColorScheme,
  tuiChatPalette,
  type TuiColorScheme,
} from "../theme";

export interface ChatHeaderState {
  approvalCount: number;
  approvalMode: string;
  branch: string | null;
  columns: number;
  contextUsage: TuiContextUsage | null;
  model: string;
  pendingCount: number;
  profile: string;
  reasoning: string;
  sending: boolean;
  sessionId: string;
  status: string;
  title: string;
  workspaceDir: string;
}

export interface ChatShortcutState {
  activeApproval: boolean;
  columns: number;
  followUpsEnabled: boolean;
  panelOpen: boolean;
  paletteOpen: boolean;
  sending: boolean;
}

function compact(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
}

export function terminalWorkspaceName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) || "workspace";
}

export function chatRunStatus(sending: boolean, status: string): string {
  if (!sending) return "ready";
  const normalized = status.replaceAll("_", " ").trim();
  return normalized && normalized !== "idle" ? normalized : "working";
}

export function chatHeaderMeta(state: ChatHeaderState): string[] {
  const available = Math.max(16, state.columns - 4);
  const items = [
    compact(state.model, Math.max(14, Math.min(34, available))),
    state.workspaceDir ? terminalWorkspaceName(state.workspaceDir) : "no workspace",
    state.branch ? `git ${state.branch}` : "",
    `reasoning ${state.reasoning}`,
    state.columns >= 96 ? `tools ${state.profile}` : "",
    state.approvalCount > 0
      ? `${state.approvalCount} approval${state.approvalCount === 1 ? "" : "s"}`
      : state.columns >= 72
        ? state.approvalMode === "always_allow"
          ? "tools allowed"
          : `tools ${state.approvalMode}`
        : "",
    state.pendingCount > 0 ? `queue ${state.pendingCount}` : "",
    state.contextUsage ? `context ${state.contextUsage.percentage}%` : "",
    state.columns >= 120 && state.sessionId ? state.sessionId.slice(0, 8) : "",
  ].filter(Boolean);
  const selected: string[] = [];
  let used = 0;
  for (const item of items) {
    const next = used + item.length + (selected.length > 0 ? 3 : 0);
    if (next > available) continue;
    selected.push(item);
    used = next;
  }
  return selected;
}

export function chatShortcutHints(state: ChatShortcutState): string[] {
  const narrow = state.columns < 56;
  const wide = state.columns >= 92;
  if (state.activeApproval) {
    if (narrow) return ["1 once", "2 session", "4 deny"];
    return wide
      ? ["1 allow once", "2 session", "3 always", "4 deny", "Esc deny"]
      : ["1 once", "2 session", "3 always", "4 deny"];
  }
  if (state.paletteOpen) return ["↑↓ choose", "Enter select", "Esc dismiss"];
  if (state.panelOpen) return ["Esc close", "PgUp/PgDn transcript"];
  if (state.sending) {
    if (narrow) return ["Enter queue", "Ctrl+C stop"];
    const active = state.followUpsEnabled
      ? ["Enter queue", "/steer redirect", "Ctrl+C stop"]
      : ["Ctrl+C stop", "/status details"];
    return wide ? [...active, "Ctrl+O work"] : active;
  }
  if (narrow) return ["Enter send", "/ commands", "? help"];
  const base = ["Enter send", "@ capabilities", "/ commands", "? help"];
  return wide
    ? [...base, "Ctrl+T transcript", "Ctrl+O work", "Esc sessions"]
    : base;
}

export function ChatHeader({
  state,
  colorScheme = resolveTuiColorScheme(process.env),
}: {
  state: ChatHeaderState;
  colorScheme?: TuiColorScheme;
}): React.ReactElement {
  const status = chatRunStatus(state.sending, state.status);
  const titleLimit = Math.max(18, state.columns - (state.sending ? 22 : 18));
  const palette = tuiChatPalette(colorScheme);
  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      <Box justifyContent="space-between">
        <Text bold color={palette.heading}>
          <Text color={palette.accent}>◆ </Text>
          {compact(state.title, titleLimit)}
        </Text>
        <Text color={state.sending ? palette.warning : palette.success}>
          {state.sending ? "◌" : "●"} {status}
        </Text>
      </Box>
      <Text color={palette.muted} wrap="wrap">
        {chatHeaderMeta(state).join(" · ")}
      </Text>
    </Box>
  );
}

export function ChatShortcutRail({
  state,
  colorScheme = resolveTuiColorScheme(process.env),
}: {
  state: ChatShortcutState;
  colorScheme?: TuiColorScheme;
}): React.ReactElement {
  const palette = tuiChatPalette(colorScheme);
  return (
    <Box paddingX={1} flexShrink={0}>
      <Text color={palette.shortcut} wrap="wrap">
        {chatShortcutHints(state).join(" · ")}
      </Text>
    </Box>
  );
}
