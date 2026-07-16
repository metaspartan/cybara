import React from "react";
import { Box, Text } from "ink";
import { parseTerminalListItem, splitTerminalInline } from "./cli-tui-markdown";
import { transcriptWindow } from "./cli-tui-terminal";
import {
  resolveTuiColorScheme,
  tuiChatPalette,
  type TuiColorScheme,
} from "./cli-tui-theme";

export function TerminalInlineSegments({
  baseColor,
  colorScheme = resolveTuiColorScheme(process.env),
  line,
}: {
  baseColor?: string;
  colorScheme?: TuiColorScheme;
  line: string;
}): React.ReactElement {
  const palette = tuiChatPalette(colorScheme);
  return (
    <>
      {splitTerminalInline(line).map((part, index) => (
        <Text
          key={index}
          bold={part.bold}
          dimColor={part.dim}
          italic={part.italic}
          strikethrough={part.strikethrough}
          color={part.code ? palette.code : (baseColor ?? palette.text)}
        >
          {part.text}
        </Text>
      ))}
    </>
  );
}

export function TerminalInlineText({
  baseColor,
  colorScheme = resolveTuiColorScheme(process.env),
  line,
}: {
  baseColor?: string;
  colorScheme?: TuiColorScheme;
  line: string;
}): React.ReactElement {
  return (
    <Text wrap="wrap">
      <TerminalInlineSegments line={line} baseColor={baseColor} colorScheme={colorScheme} />
    </Text>
  );
}

export function TerminalMessageBody({
  baseColor,
  content,
  hiddenText,
  maxColumns,
  maxLines,
  colorScheme = resolveTuiColorScheme(process.env),
}: {
  baseColor?: string;
  content: string;
  colorScheme?: TuiColorScheme;
  hiddenText?: string;
  maxColumns?: number;
  maxLines?: number;
}): React.ReactElement {
  const palette = tuiChatPalette(colorScheme);
  const lines = transcriptWindow(
    content,
    maxLines ?? Number.MAX_SAFE_INTEGER,
    maxColumns,
    hiddenText,
  );
  return (
    <Box flexDirection="column" width="100%">
      {lines.map((line, index) => {
        if (line.hidden) {
          return (
            <Text key={index} color={palette.muted} wrap="wrap">
              {line.text}
            </Text>
          );
        }
        if (line.fence) {
          return (
            <Text key={index} color={palette.subtle} wrap="wrap">
              {line.fence === "open"
                ? `code${line.language ? ` · ${line.language}` : ""}`
                : "end code"}
            </Text>
          );
        }
        if (line.code) {
          return (
            <Text key={index} color={palette.code} wrap="wrap">
              {line.text || " "}
            </Text>
          );
        }
        const listItem = parseTerminalListItem(line.text);
        if (listItem?.kind === "task") {
          return (
            <Text key={index} wrap="wrap">
              {listItem.indent}
              <Text color={listItem.checked ? palette.success : palette.muted}>
                {listItem.checked ? "☑ " : "☐ "}
              </Text>
              <TerminalInlineSegments
                line={listItem.content}
                baseColor={baseColor}
                colorScheme={colorScheme}
              />
            </Text>
          );
        }
        if (listItem?.kind === "bullet") {
          return (
            <Text key={index} wrap="wrap">
              {listItem.indent}
              <Text color={palette.accent}>• </Text>
              <TerminalInlineSegments
                line={listItem.content}
                baseColor={baseColor}
                colorScheme={colorScheme}
              />
            </Text>
          );
        }
        if (listItem?.kind === "ordered") {
          return (
            <Text key={index} wrap="wrap">
              {listItem.indent}
              <Text color={palette.accent}>{listItem.number}. </Text>
              <TerminalInlineSegments
                line={listItem.content}
                baseColor={baseColor}
                colorScheme={colorScheme}
              />
            </Text>
          );
        }
        if (/^#{1,6}\s/.test(line.text)) {
          return (
            <Text key={index} bold color={palette.heading} wrap="wrap">
              {line.text.replace(/^#{1,6}\s/, "")}
            </Text>
          );
        }
        if (/^\s*>\s?/.test(line.text)) {
          return (
            <Text key={index} color={palette.muted} wrap="wrap">
              ▏ {line.text.replace(/^\s*>\s?/, "")}
            </Text>
          );
        }
        return (
          <TerminalInlineText
            key={index}
            line={line.text}
            baseColor={baseColor}
            colorScheme={colorScheme}
          />
        );
      })}
    </Box>
  );
}
