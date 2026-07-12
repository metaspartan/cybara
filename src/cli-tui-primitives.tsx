import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import Spinner from "ink-spinner";

export function TUILogo({ compact = false }: { compact?: boolean }): React.ReactElement {
  return (
    <Box justifyContent="center" marginBottom={compact ? 0 : 1} flexShrink={0}>
      <Gradient name="rainbow">
        <Text bold>CYBARA</Text>
      </Gradient>
      <Text color="gray"> · {compact ? "TUI" : "Agent Platform · Terminal"}</Text>
    </Box>
  );
}

export function TUITable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        {headers.map((header, index) => (
          <Box key={header} width={index === 0 ? 20 : 15} marginRight={1}>
            <Text bold color="cyan">
              {header}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginBottom={1}>
        <Text color="gray">{"─".repeat(60)}</Text>
      </Box>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {row.map((cell, columnIndex) => (
            <Box key={columnIndex} width={columnIndex === 0 ? 20 : 15} marginRight={1}>
              {typeof cell === "string" ? <Text>{cell}</Text> : cell}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function TUIStatusBadge({ status }: { status: string }): React.ReactElement {
  const colors: Record<string, string> = {
    healthy: "green",
    running: "green",
    active: "green",
    eligible: "green",
    stopped: "yellow",
    error: "red",
    blocked: "red",
  };
  return <Text color={colors[status] || "white"}>{status}</Text>;
}

export function TUILoadingState({ message }: { message: string }): React.ReactElement {
  return (
    <Box>
      <Text color="yellow">
        <Spinner type="dots" /> {message}
      </Text>
    </Box>
  );
}

export function TUIErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <Box>
      <Text color="red">✗ {message}</Text>
    </Box>
  );
}
