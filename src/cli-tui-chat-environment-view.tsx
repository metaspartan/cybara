import React from "react";
import { Box, Text } from "ink";
import {
  formatContextUsageLine,
  formatFileChangeLine,
  formatPlanLine,
  formatSubagentLine,
  formatTaskLine,
  formatTokenUsageLine,
  shortPath,
  type TuiEnvironmentSnapshot,
  type TuiPlanItem,
  type TuiSubagentSummary,
  type TuiTaskSummary,
} from "./cli-tui-chat-environment";
import {
  resolveTuiColorScheme,
  tuiChatPalette,
  type TuiColorScheme,
  type TuiSurfacePalette,
} from "./cli-tui-theme";

export type EnvironmentPanelVariant = "stacked" | "sidebar";

export interface EnvironmentPanelProps {
  compact?: boolean;
  snapshot: TuiEnvironmentSnapshot | null;
  subagents: TuiSubagentSummary[];
  tasks: TuiTaskSummary[];
  colorScheme?: TuiColorScheme;
  variant?: EnvironmentPanelVariant;
  width?: number;
}

function planMarker(item: TuiPlanItem): { color: "gray" | "green" | "yellow"; glyph: string } {
  if (item.status === "completed") return { color: "green", glyph: "✓" };
  if (item.status === "in_progress") return { color: "yellow", glyph: "◌" };
  return { color: "gray", glyph: "○" };
}

function SectionTitle({
  children,
  palette,
}: {
  children: React.ReactNode;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text bold color={palette.text}>
        {children}
      </Text>
    </Box>
  );
}

function PlanDetails({
  snapshot,
  maxRows,
  palette,
}: {
  snapshot: TuiEnvironmentSnapshot | null;
  maxRows: number;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  const plan = snapshot?.plan || null;
  return (
    <Box flexDirection="column">
      <SectionTitle palette={palette}>Plan</SectionTitle>
      <Text color={palette.muted}>{formatPlanLine(plan)}</Text>
      {plan?.items.slice(0, maxRows).map((item, index) => {
        const marker = planMarker(item);
        return (
          <Text key={String(index) + "-" + item.content} color={marker.color} wrap="truncate-end">
            {marker.glyph} {item.content}
          </Text>
        );
      })}
    </Box>
  );
}

function FileDetails({
  snapshot,
  maxRows,
  palette,
}: {
  snapshot: TuiEnvironmentSnapshot | null;
  maxRows: number;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  const changes = snapshot?.fileChanges || null;
  return (
    <Box flexDirection="column">
      <SectionTitle palette={palette}>Changes</SectionTitle>
      <Text color={palette.muted}>{formatFileChangeLine(changes)}</Text>
      {changes?.files.slice(0, maxRows).map((file) => (
        <Text key={file.path} color={palette.text} wrap="truncate-end">
          {file.type === "created" ? "+" : "~"} {shortPath(file.path, 30)}{" "}
          <Text color="green">+{file.added}</Text> <Text color="red">-{file.removed}</Text>
        </Text>
      ))}
    </Box>
  );
}

function WorkDetails({
  tasks,
  subagents,
  palette,
}: {
  tasks: TuiTaskSummary[];
  subagents: TuiSubagentSummary[];
  palette: TuiSurfacePalette;
}): React.ReactElement {
  return (
    <>
      <Box flexDirection="column">
        <SectionTitle palette={palette}>Tasks</SectionTitle>
        {tasks.length === 0 ? (
          <Text color={palette.muted}>none</Text>
        ) : (
          tasks.slice(0, 4).map((task) => (
            <Text key={task.id} color={palette.text} wrap="truncate-end">
              {formatTaskLine(task)}
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="column">
        <SectionTitle palette={palette}>Subagents</SectionTitle>
        {subagents.length === 0 ? (
          <Text color={palette.muted}>none</Text>
        ) : (
          subagents.slice(0, 4).map((subagent) => (
            <Text key={subagent.id} color={palette.text} wrap="truncate-end">
              {formatSubagentLine(subagent)}
            </Text>
          ))
        )}
      </Box>
    </>
  );
}

export function EnvironmentPanel({
  snapshot,
  subagents,
  tasks,
  compact = false,
  colorScheme = resolveTuiColorScheme(process.env),
  variant = "stacked",
  width,
}: EnvironmentPanelProps): React.ReactElement {
  const sidebar = variant === "sidebar";
  const pathWidth = Math.max(16, (width || 42) - 13);
  const palette = tuiChatPalette(colorScheme);
  return (
    <Box
      flexDirection="column"
      borderStyle={sidebar ? "single" : "round"}
      borderColor={palette.border}
      borderTop={!sidebar}
      borderRight={!sidebar}
      borderBottom={!sidebar}
      borderLeft
      backgroundColor={sidebar ? palette.background : undefined}
      paddingX={1}
      marginLeft={sidebar ? 1 : 0}
      marginTop={sidebar ? 0 : 1}
      width={sidebar ? width : undefined}
      height={sidebar ? "100%" : undefined}
      flexShrink={sidebar ? 0 : 1}
      overflow="hidden"
    >
      <Box justifyContent="space-between">
        <Text bold color={palette.accent}>
          Session inspector
        </Text>
        {compact ? null : <Text color={palette.muted}>/environment</Text>}
      </Box>
      <Text color={palette.text} wrap="truncate-end">
        {snapshot?.workspaceDir ? shortPath(snapshot.workspaceDir, pathWidth) : "No workspace"}
      </Text>
      <Text color={palette.muted} wrap="truncate-end">
        {snapshot?.gitBranch ? "git " + snapshot.gitBranch : "No branch"}
      </Text>
      <SectionTitle palette={palette}>Usage</SectionTitle>
      <Text color={palette.muted} wrap="wrap">
        {formatContextUsageLine(snapshot?.contextUsage || null)}
      </Text>
      <Text color={palette.muted} wrap="wrap">
        {formatTokenUsageLine(snapshot?.tokenUsage || null)}
      </Text>
      {compact ? (
        <>
          <Text color={palette.muted}>{formatFileChangeLine(snapshot?.fileChanges || null)}</Text>
          <Text color={palette.muted}>{formatPlanLine(snapshot?.plan || null)}</Text>
          <Text color={palette.muted}>Tasks {tasks.length} · Subagents {subagents.length}</Text>
        </>
      ) : (
        <>
          <PlanDetails snapshot={snapshot} maxRows={sidebar ? 5 : 3} palette={palette} />
          <FileDetails snapshot={snapshot} maxRows={sidebar ? 4 : 3} palette={palette} />
          <WorkDetails tasks={tasks} subagents={subagents} palette={palette} />
        </>
      )}
    </Box>
  );
}
