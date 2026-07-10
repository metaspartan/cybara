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
  type TuiSubagentSummary,
  type TuiTaskSummary,
} from "./cli-tui-chat-environment";

export function EnvironmentPanel({
  snapshot,
  subagents,
  tasks,
  compact,
}: {
  snapshot: TuiEnvironmentSnapshot | null;
  subagents: TuiSubagentSummary[];
  tasks: TuiTaskSummary[];
  compact?: boolean;
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Environment
        </Text>
        {compact ? null : <Text color="gray">/environment hides · /context refreshes</Text>}
      </Box>
      <Text color="gray">{snapshot?.workspaceDir ? `Workspace ${shortPath(snapshot.workspaceDir)}` : "No workspace"}</Text>
      <Text color="gray">{snapshot?.gitBranch ? `Branch ${snapshot.gitBranch}` : "Branch not loaded"}</Text>
      <Text color="gray">{formatContextUsageLine(snapshot?.contextUsage || null)}</Text>
      <Text color="gray">{formatTokenUsageLine(snapshot?.tokenUsage || null)}</Text>
      <Text color="gray">{formatFileChangeLine(snapshot?.fileChanges || null)}</Text>
      <Text color="gray">{formatPlanLine(snapshot?.plan || null)}</Text>

      {compact ? (
        <Text color="gray">Tasks {tasks.length} · Subagents {subagents.length}</Text>
      ) : (
        <>
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">Tasks</Text>
            {tasks.length === 0 ? (
              <Text color="gray">  none</Text>
            ) : (
              tasks.slice(0, 5).map((task) => (
                <Text key={task.id} color="white">
                  {"  "}
                  {formatTaskLine(task)}
                </Text>
              ))
            )}
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text color="gray">Subagents</Text>
            {subagents.length === 0 ? (
              <Text color="gray">  none</Text>
            ) : (
              subagents.slice(0, 6).map((subagent) => (
                <Text key={subagent.id} color="white">
                  {"  "}
                  {formatSubagentLine(subagent)}
                </Text>
              ))
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
