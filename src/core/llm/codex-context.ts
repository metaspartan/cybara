import {
  assertResponsesToolPairing,
  compactedToolResult,
  compactToolTranscriptInPlace,
  isCompactedToolResult,
  minimizeCompactedToolResult,
  type ToolResultFormat,
} from "./tool-transcript";

function responsesToolResultFormat(sessionId?: string): ToolResultFormat<Record<string, unknown>> {
  return {
    isToolResult: (item) => item.type === "function_call_output",
    estimateChars: (item) => JSON.stringify(item).length + 8,
    isElided: (item) => isCompactedToolResult(item.output),
    elide: (item) => {
      item.output = compactedToolResult(item.output, sessionId);
    },
    minimize: (item) => {
      const minimized = minimizeCompactedToolResult(item.output);
      if (minimized === undefined) return false;
      item.output = minimized;
      return true;
    },
  };
}

export function compactCodexInputItemsForContext(
  inputItems: Array<Record<string, unknown>>,
  budgetChars: number,
  aggressive = false,
  sessionId?: string
): void {
  const elided = compactToolTranscriptInPlace(
    inputItems,
    budgetChars,
    responsesToolResultFormat(sessionId),
    {
      aggressive,
    }
  );
  if (elided > 0) {
    console.warn(
      `[Agent] Context compaction: elided ${elided} old tool result(s) to stay under the input budget`
    );
  }
}

export function sanitizeCodexInputItems(inputItems: Array<Record<string, unknown>>): {
  droppedOutputs: number;
} {
  return { droppedOutputs: assertResponsesToolPairing(inputItems) };
}
