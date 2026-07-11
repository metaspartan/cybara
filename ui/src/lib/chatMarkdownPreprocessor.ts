const INBOUND_CONTEXT_HEADERS = [
  "Conversation info (untrusted metadata):",
  "Sender (untrusted metadata):",
  "Thread starter (untrusted, for context):",
  "Replied message (untrusted, for context):",
  "Forwarded message context (untrusted metadata):",
  "Chat history since last reply (untrusted, for context):",
] as const;

function stripInboundContextBlocks(raw: string): string {
  if (!INBOUND_CONTEXT_HEADERS.some((header) => raw.includes(header))) {
    return raw;
  }

  const normalized = raw.replace(/\r\n/g, "\n");
  const outputLines: string[] = [];
  let inMetaBlock = false;
  let inFencedJson = false;

  for (const line of normalized.split("\n")) {
    if (!inMetaBlock && INBOUND_CONTEXT_HEADERS.some((header) => line.startsWith(header))) {
      inMetaBlock = true;
      inFencedJson = false;
      continue;
    }

    if (inMetaBlock) {
      const trimmed = line.trim();
      if (!inFencedJson && trimmed === "```json") {
        inFencedJson = true;
        continue;
      }

      if (inFencedJson) {
        if (trimmed === "```") {
          inMetaBlock = false;
          inFencedJson = false;
        }
        continue;
      }

      if (trimmed.length === 0) {
        continue;
      }

      inMetaBlock = false;
    }

    outputLines.push(line);
  }

  return outputLines.join("\n").replace(/^\n+/, "");
}

function stripPrefixedTimestamps(raw: string): string {
  const pattern =
    /^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC)[+-]?\d{0,2}\]\s*/gm;
  return raw.replace(pattern, "");
}

function replaceMathDelimiters(line: string): string {
  let output = "";
  let index = 0;
  let inlineCodeTicks = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      let tickEnd = index;
      while (line[tickEnd] === "`") tickEnd += 1;
      const tickCount = tickEnd - index;
      if (inlineCodeTicks === 0) inlineCodeTicks = tickCount;
      else if (inlineCodeTicks === tickCount) inlineCodeTicks = 0;
      output += line.slice(index, tickEnd);
      index = tickEnd;
      continue;
    }

    if (inlineCodeTicks === 0) {
      const delimiter = line.slice(index, index + 2);
      if (delimiter === "\\(") {
        output += "$";
        index += 2;
        continue;
      }
      if (delimiter === "\\)") {
        output += "$";
        index += 2;
        continue;
      }
      if (delimiter === "\\[") {
        output += "\n$$\n";
        index += 2;
        continue;
      }
      if (delimiter === "\\]") {
        output += "\n$$\n";
        index += 2;
        continue;
      }
    }

    output += line[index];
    index += 1;
  }

  return output;
}

function normalizeMathDelimiters(raw: string): string {
  let fenceMarker = "";
  return raw
    .split("\n")
    .map((line) => {
      const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? "";
      if (fence) {
        if (!fenceMarker) fenceMarker = fence[0] ?? "";
        else if (fence[0] === fenceMarker) fenceMarker = "";
        return line;
      }
      return fenceMarker ? line : replaceMathDelimiters(line);
    })
    .join("\n");
}

function normalize(raw: string): string {
  let output = raw.replace(/\r\n/g, "\n");
  output = output.replace(/\n\n\n/g, "\n\n");
  output = output.replace(/\n\n\n/g, "\n\n");
  return output.trim();
}

export function preprocessChatMarkdown(raw: string): string {
  const withoutContext = stripInboundContextBlocks(raw);
  const withoutTimestamps = stripPrefixedTimestamps(withoutContext);
  return normalize(normalizeMathDelimiters(withoutTimestamps));
}
