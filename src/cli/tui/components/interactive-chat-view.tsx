import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { matchingTUIChatCommands } from "../commands";
import {
  formatTUIWorkedDuration,
  limitTUIActivityDetails,
  presentTUIActivities,
  tuiActivityTone,
  type TUIActivityItem,
  type TUIToolCallItem,
} from "../activity";
import type { TUIStreamActivity } from "../status-stream";
import type { TuiColorScheme, TuiSurfacePalette } from "../theme";
import { TerminalInlineText, TerminalMessageBody } from "./markdown-render";

export interface AgentTransferItem {
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  reason: string;
  requestedAt?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  process_activities?: TUIActivityItem[];
  tool_calls?: TUIToolCallItem[];
  agent_transfers?: AgentTransferItem[];
}

export interface PendingMessage {
  id: string;
  content: string;
  sequence?: number;
  mode?: string;
  createdAt?: number;
}

const ROLE_META: Record<ChatMessage["role"], { label: string; marker: string }> = {
  user: { label: "You", marker: ">" },
  assistant: { label: "Cybara", marker: "◆" },
  system: { label: "System", marker: "-" },
};

function relativeTime(value?: number): string {
  if (!value) return "now";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function ActivitySummary({
  colorScheme,
  expanded = false,
  live = false,
  message,
  maxDetails,
  maxColumns,
  palette,
}: {
  colorScheme: TuiColorScheme;
  expanded?: boolean;
  live?: boolean;
  message: ChatMessage;
  maxDetails?: number;
  maxColumns: number;
  palette: TuiSurfacePalette;
}): React.ReactElement | null {
  const steeringActivities = (message.process_activities || []).filter(
    (activity) => activity.toolName === "__steering",
  );
  const workActivities = (message.process_activities || []).filter(
    (activity) => activity.toolName !== "__steering",
  );
  const rows = presentTUIActivities(workActivities, message.tool_calls || []);
  if (rows.length === 0 && steeringActivities.length === 0) return null;
  const hiddenLiveRows = live ? Math.max(0, rows.length - 6) : 0;
  const visibleRows = hiddenLiveRows > 0 ? rows.slice(-6) : rows;
  const workedDuration = formatTUIWorkedDuration(workActivities, message.tool_calls || []);
  return (
    <Box
      paddingLeft={2}
      marginBottom={1}
      flexDirection="column"
      width={Math.max(12, maxColumns)}
    >
      {rows.length > 0 ? (
        <Text color={palette.muted}>
          {live ? "◌" : expanded ? "▾" : "▸"} {live ? "Working" : "Worked"} for{" "}
          {workedDuration}
        </Text>
      ) : null}
      {hiddenLiveRows > 0 ? (
        <Text color={palette.subtle}>… {hiddenLiveRows} earlier work groups</Text>
      ) : null}
      {rows.length > 0 && (live || expanded)
        ? visibleRows.map((row, rowIndex) => (
            <Box key={`${row.id}-${rowIndex}`} flexDirection="column">
              {row.thought ? (
                live ? (
                  <Text color={palette.detail} wrap="truncate-end">
                    {row.label}
                  </Text>
                ) : (
                  <TerminalInlineText
                    line={row.label}
                    baseColor={palette.detail}
                    colorScheme={colorScheme}
                  />
                )
              ) : (
                <Text
                  color={palette[tuiActivityTone(row)]}
                  wrap={live ? "truncate-end" : "wrap"}
                >
                  {row.icon ? `${row.icon} ` : ""}
                  {row.label}
                </Text>
              )}
              {limitTUIActivityDetails(
                row.details,
                live ? Math.min(4, maxDetails ?? 4) : (maxDetails ?? row.details.length),
              ).map(
                (label, index, details) => (
                  <Text
                    key={`${row.id}-${rowIndex}-${index}`}
                    color={palette.detail}
                    wrap={live ? "truncate-end" : "wrap"}
                  >
                    {index === details.length - 1 ? "└" : "├"} {label}
                  </Text>
                ),
              )}
            </Box>
          ))
        : null}
      {steeringActivities.map((activity, index) => (
        <Text key={activity.id || `steered-${index}`} color={palette.muted} wrap="wrap">
          ↔ {activity.text || "Conversation steered."}
        </Text>
      ))}
    </Box>
  );
}

export function MessageView({
  expandedActivities,
  expandedMessage,
  message,
  maxLines,
  maxActivityDetails,
  maxColumns,
  colorScheme,
  palette,
}: {
  expandedActivities: boolean;
  expandedMessage: boolean;
  message: ChatMessage;
  maxLines?: number;
  maxActivityDetails?: number;
  maxColumns: number;
  colorScheme: TuiColorScheme;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  const meta = ROLE_META[message.role];
  const roleColor =
    message.role === "user"
      ? palette.user
      : message.role === "assistant"
        ? palette.heading
        : palette.muted;
  const bodyColor =
    message.role === "user"
      ? palette.detail
      : message.role === "assistant"
        ? palette.text
        : palette.muted;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={roleColor}>
          {meta.marker} {meta.label}
        </Text>
      </Box>
      <ActivitySummary
        colorScheme={colorScheme}
        expanded={expandedActivities}
        message={message}
        maxColumns={maxColumns}
        maxDetails={maxActivityDetails}
        palette={palette}
      />
      {message.agent_transfers?.map((transfer) => (
        <Text
          key={`${transfer.fromAgentId}-${transfer.toAgentId}-${transfer.requestedAt || "transfer"}`}
          color={palette.detail}
        >
          {"  ⇄ "}Transferred from {transfer.fromAgentName} to {transfer.toAgentName}
        </Text>
      ))}
      <Box paddingLeft={2} width="100%">
        <TerminalMessageBody
          baseColor={bodyColor}
          content={message.content}
          colorScheme={colorScheme}
          hiddenText={
            expandedMessage
              ? "… more content hidden · /copy copies the full response"
              : "… more content hidden · /expand shows more"
          }
          maxColumns={maxColumns}
          maxLines={maxLines}
        />
      </Box>
    </Box>
  );
}

export function LiveRunView({
  activities,
  content,
  detail,
  maxColumns,
  colorScheme,
  palette,
}: {
  activities: TUIStreamActivity[];
  content: string;
  detail: string;
  maxColumns: number;
  colorScheme: TuiColorScheme;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={palette.heading}>
        ◆ Cybara{" "}
        <Text color={palette.muted}>
          <Spinner type="dots" />
        </Text>
      </Text>
      <ActivitySummary
        colorScheme={colorScheme}
        expanded
        live
        message={{ role: "assistant", content: "", process_activities: activities }}
        maxColumns={maxColumns}
        palette={palette}
      />
      {content ? (
        <Box paddingLeft={2} width="100%">
          <TerminalMessageBody
            content={content}
            baseColor={palette.text}
            colorScheme={colorScheme}
          />
        </Box>
      ) : detail ? (
        <Text color={palette.muted} wrap="truncate-end">
          {" "}
          {detail}
        </Text>
      ) : null}
    </Box>
  );
}

export function PendingQueue({
  messages,
  palette,
}: {
  messages: PendingMessage[];
  palette: TuiSurfacePalette;
}): React.ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color={palette.warning}>
        Queue · {messages.length}
      </Text>
      {messages.slice(0, 4).map((message, index) => (
        <Text
          key={message.id}
          color={message.mode === "steering" ? palette.warning : palette.text}
          wrap="wrap"
        >
          {"  "}#{message.sequence || index + 1} {message.content}
          <Text color={palette.subtle}> · {relativeTime(message.createdAt)}</Text>
        </Text>
      ))}
      {messages.length > 4 ? (
        <Text color={palette.subtle}> +{messages.length - 4} more · /pending</Text>
      ) : null}
    </Box>
  );
}

export function CommandPalette({
  input,
  compactMode,
  maxRows,
  selectedIndex,
  palette,
}: {
  input: string;
  compactMode: boolean;
  maxRows: number;
  selectedIndex: number;
  palette: TuiSurfacePalette;
}): React.ReactElement | null {
  const matches = matchingTUIChatCommands(input, maxRows);
  if (matches.length === 0) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={palette.border}
      paddingX={1}
      marginTop={1}
    >
      {matches.map((command, index) => (
        <Text key={command.name} inverse={index === selectedIndex}>
          <Text color={index === selectedIndex ? palette.heading : palette.accent}>
            {index === selectedIndex ? "› " : "  "}
            {command.name}
          </Text>
          {compactMode ? null : <Text color={palette.muted}> — {command.detail}</Text>}
        </Text>
      ))}
    </Box>
  );
}

export function HelpPanel({
  narrow,
  palette,
}: {
  narrow: boolean;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  if (narrow) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.border}
        paddingX={1}
        marginTop={1}
      >
        <Text bold color={palette.heading}>
          Chat controls
        </Text>
        <Text>Enter send · Shift+Enter/^J newline · Tab complete</Text>
        <Text>^P commands · ^F search · PgUp/PgDn scroll</Text>
        <Text>Esc sessions · ^C quit</Text>
        <Text>/model · /agent · /permissions · /followups · /reasoning</Text>
        <Text>/copy [n] · /export · /diff · /environment</Text>
        <Text>/goal or /loop for persistent work</Text>
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.border}
      paddingX={1}
      marginTop={1}
    >
      <Text bold color={palette.heading}>
        Chat controls
      </Text>
      <Text>
        Enter send · Shift+Enter/Ctrl+J newline · ←/→ move · ↑/↓ palette or history
      </Text>
      <Text>Alt+←/→ words · Ctrl+W delete word · PgUp/PgDn transcript</Text>
      <Text>Ctrl+P commands · Ctrl+F transcript search · Esc closes the active panel</Text>
      <Text>
        Tab completes slash commands and @ capabilities · approvals use 1/2/3/4 or y/s/a/n
      </Text>
      <Text>
        /agents lists · /agent name switches · /router on|off · /permissions ask|always_allow
      </Text>
      <Text>/followups on|off controls queue and steer behavior</Text>
      <Text>/reasoning changes effort · /title renames · /workspace changes the working root</Text>
      <Text>/environment toggles context, plan, diffs, tasks, and subagents</Text>
      <Text>/goal start &lt;objective&gt; creates persistent work · /loop is an alias</Text>
      <Text>/context, /usage, /plan, /diffs, /tasks, /subagents inspect session state</Text>
      <Text>/queue queues · /steer injects · /edit, /delete, /reorder manage queue</Text>
      <Text>/stop interrupts · /pending refreshes queue</Text>
      <Text>/copy [n] copies an answer · /export writes Markdown · /diff shows changes</Text>
      <Text>/terminal-info checks viewport, color, clipboard, and screen mode</Text>
      <Text>/reload refetches · /new starts fresh · /resume returns to sessions</Text>
      <Text>/raw or /expand toggles compact and detailed message bodies</Text>
    </Box>
  );
}

export function ChatFeedback({
  error,
  notice,
  palette,
}: {
  error: string | null;
  notice: string | null;
  palette: TuiSurfacePalette;
}): React.ReactElement | null {
  if (error) {
    return (
      <Box paddingX={1}>
        <Text color={palette.danger}>Error: {error}</Text>
      </Box>
    );
  }
  if (!notice) return null;
  return (
    <Box paddingX={1}>
      <Text color={palette.muted}>{notice}</Text>
    </Box>
  );
}

export function ActiveRunHint({
  followUpsEnabled,
  palette,
}: {
  followUpsEnabled: boolean;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text color={palette.accent}>
        <Spinner type="dots" /> {followUpsEnabled ? "Enter queues · /steer injects" : "Follow-ups off"}{" "}
        · Ctrl+C stops
      </Text>
    </Box>
  );
}

export function ChatComposerBox({
  followUpsEnabled,
  input,
  lines,
  palette,
  sending,
  textColor,
  title,
}: {
  followUpsEnabled: boolean;
  input: string;
  lines: string[];
  palette: TuiSurfacePalette;
  sending: boolean;
  textColor: string;
  title: string;
}): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor={sending ? palette.accent : palette.chrome}
      backgroundColor={palette.background}
      paddingX={1}
      flexDirection="column"
      flexShrink={0}
    >
      {sending ? (
        <Text color={followUpsEnabled ? palette.accent : palette.muted}>{title}</Text>
      ) : null}
      {lines.map((line, index) => (
        <Text key={index} color={input ? textColor : palette.subtle}>
          {index === 0 ? "› " : "  "}
          {line}
        </Text>
      ))}
    </Box>
  );
}
