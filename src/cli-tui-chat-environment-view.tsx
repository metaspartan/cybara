import React from "react";
import { Box, Text } from "ink";
import {
  formatContextUsageLine,
  formatFileChangeLine,
  formatPlanLine,
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

function planMarker(item: TuiPlanItem, palette: TuiSurfacePalette): { color: string; glyph: string } {
  if (item.status === "completed") return { color: palette.success, glyph: "✓" };
  if (item.status === "in_progress") return { color: palette.warning, glyph: "◌" };
  return { color: palette.subtle, glyph: "○" };
}

function LabeledLine({
  palette,
  value,
}: {
  palette: TuiSurfacePalette;
  value: string;
}): React.ReactElement {
  const separator = value.indexOf(":");
  if (separator < 0) return <Text color={palette.text}>{value}</Text>;
  return (
    <Text wrap="wrap">
      <Text color={palette.muted}>{value.slice(0, separator + 1)}</Text>
      <Text color={palette.text}>{value.slice(separator + 1)}</Text>
    </Text>
  );
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
      <Text bold color={palette.section}>
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
      <LabeledLine palette={palette} value={formatPlanLine(plan)} />
      {plan?.items.slice(0, maxRows).map((item, index) => {
        const marker = planMarker(item, palette);
        return (
          <Text key={String(index) + "-" + item.content} wrap="truncate-end">
            <Text color={marker.color}>{marker.glyph}</Text>{" "}
            <Text color={palette.text}>{item.content}</Text>
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
      <LabeledLine palette={palette} value={formatFileChangeLine(changes)} />
      {changes?.files.slice(0, maxRows).map((file) => (
        <Text key={file.path} wrap="truncate-end">
          <Text color={palette.subtle}>{file.type === "created" ? "+" : "~"}</Text>{" "}
          <Text color={palette.text}>{shortPath(file.path, 30)}</Text>{" "}
          <Text color={palette.success}>+{file.added}</Text>{" "}
          <Text color={palette.danger}>-{file.removed}</Text>
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
          <Text color={palette.subtle}>none</Text>
        ) : (
          tasks.slice(0, 4).map((task) => (
            <Text key={task.id} wrap="truncate-end">
              <Text color={palette.muted}>{task.status.padEnd(10)}</Text>{" "}
              <Text color={palette.text}>
                {task.priority ? `[${task.priority}] ` : ""}
                {task.title}
              </Text>
            </Text>
          ))
        )}
      </Box>
      <Box flexDirection="column">
        <SectionTitle palette={palette}>Subagents</SectionTitle>
        {subagents.length === 0 ? (
          <Text color={palette.subtle}>none</Text>
        ) : (
          subagents.slice(0, 4).map((subagent) => (
            <Text key={subagent.id} wrap="truncate-end">
              <Text color={palette.muted}>{subagent.status.padEnd(10)}</Text>{" "}
              <Text color={palette.text}>{subagent.label}</Text>
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
      borderColor={palette.chrome}
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
        <Text bold color={palette.heading}>
          Session inspector
        </Text>
        {compact ? null : <Text color={palette.muted}>/environment</Text>}
      </Box>
      <Text color={palette.detail} wrap="truncate-end">
        {snapshot?.workspaceDir ? shortPath(snapshot.workspaceDir, pathWidth) : "No workspace"}
      </Text>
      <Text wrap="truncate-end">
        <Text color={palette.subtle}>git </Text>
        <Text color={palette.detail}>{snapshot?.gitBranch || "No branch"}</Text>
      </Text>
      <SectionTitle palette={palette}>Usage</SectionTitle>
      <LabeledLine palette={palette} value={formatContextUsageLine(snapshot?.contextUsage || null)} />
      <LabeledLine palette={palette} value={formatTokenUsageLine(snapshot?.tokenUsage || null)} />
      {compact ? (
        <>
          <LabeledLine palette={palette} value={formatFileChangeLine(snapshot?.fileChanges || null)} />
          <LabeledLine palette={palette} value={formatPlanLine(snapshot?.plan || null)} />
          <Text>
            <Text color={palette.muted}>Tasks </Text>
            <Text color={palette.text}>{tasks.length}</Text>
            <Text color={palette.muted}> · Subagents </Text>
            <Text color={palette.text}>{subagents.length}</Text>
          </Text>
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
