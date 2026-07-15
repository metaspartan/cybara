import React from "react";
import { Box, Text } from "ink";
import { parseTerminalListItem, splitTerminalInline } from "./cli-tui-markdown";
import { transcriptWindow } from "./cli-tui-terminal";

export function TerminalInlineSegments({
  line,
}: {
  line: string;
}): React.ReactElement {
  return (
    <>
      {splitTerminalInline(line).map((part, index) => (
        <Text
          key={index}
          bold={part.bold}
          dimColor={part.dim}
          italic={part.italic}
          strikethrough={part.strikethrough}
          color={part.code ? "magenta" : undefined}
        >
          {part.text}
        </Text>
      ))}
    </>
  );
}

export function TerminalInlineText({
  line,
}: {
  line: string;
}): React.ReactElement {
  return (
    <Text wrap="wrap">
      <TerminalInlineSegments line={line} />
    </Text>
  );
}

export function TerminalMessageBody({
  content,
  maxLines,
}: {
  content: string;
  maxLines?: number;
}): React.ReactElement {
  const lines = transcriptWindow(content, maxLines ?? Number.MAX_SAFE_INTEGER);
  return (
    <Box flexDirection="column" width="100%">
      {lines.map((line, index) => {
        if (line.hidden) {
          return (
            <Text key={index} color="#9ca6b4" wrap="wrap">
              {line.text}
            </Text>
          );
        }
        if (line.fence) {
          return (
            <Text key={index} color="magenta" wrap="wrap">
              {line.fence === "open"
                ? `code${line.language ? ` · ${line.language}` : ""}`
                : "end code"}
            </Text>
          );
        }
        if (line.code) {
          return (
            <Text key={index} color="green" wrap="wrap">
              {line.text || " "}
            </Text>
          );
        }
        const listItem = parseTerminalListItem(line.text);
        if (listItem?.kind === "task") {
          return (
            <Text key={index} wrap="wrap">
              {listItem.indent}
              <Text color={listItem.checked ? "green" : "gray"}>
                {listItem.checked ? "☑ " : "☐ "}
              </Text>
              <TerminalInlineSegments line={listItem.content} />
            </Text>
          );
        }
        if (listItem?.kind === "bullet") {
          return (
            <Text key={index} wrap="wrap">
              {listItem.indent}
              <Text color="cyan">• </Text>
              <TerminalInlineSegments line={listItem.content} />
            </Text>
          );
        }
        if (listItem?.kind === "ordered") {
          return (
            <Text key={index} wrap="wrap">
              {listItem.indent}
              <Text color="cyan">{listItem.number}. </Text>
              <TerminalInlineSegments line={listItem.content} />
            </Text>
          );
        }
        if (/^#{1,6}\s/.test(line.text)) {
          return (
            <Text key={index} bold wrap="wrap">
              {line.text.replace(/^#{1,6}\s/, "")}
            </Text>
          );
        }
        if (/^\s*>\s?/.test(line.text)) {
          return (
            <Text key={index} color="gray" wrap="wrap">
              ▏ {line.text.replace(/^\s*>\s?/, "")}
            </Text>
          );
        }
        return <TerminalInlineText key={index} line={line.text} />;
      })}
    </Box>
  );
}
