import {
  assertResponsesToolPairing,
  compactedToolResult,
  compactToolTranscriptInPlace,
  isCompactedToolResult,
  minimizeCompactedToolResult,
  type ToolResultFormat,
} from "./tool-transcript";

const responsesToolResultFormat: ToolResultFormat<Record<string, unknown>> = {
  isToolResult: (item) => item.type === "function_call_output",
  estimateChars: (item) => JSON.stringify(item).length + 8,
  isElided: (item) => isCompactedToolResult(item.output),
  elide: (item) => {
    item.output = compactedToolResult(item.output);
  },
  minimize: (item) => {
    const minimized = minimizeCompactedToolResult(item.output);
    if (minimized === undefined) return false;
    item.output = minimized;
    return true;
  },
};

export function compactCodexInputItemsForContext(
  inputItems: Array<Record<string, unknown>>,
  budgetChars: number,
  aggressive = false
): void {
  const elided = compactToolTranscriptInPlace(inputItems, budgetChars, responsesToolResultFormat, {
    aggressive,
  });
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
