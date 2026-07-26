import {
  assertResponsesToolPairing,
  compactToolTranscriptInPlace,
  TOOL_RESULT_COMPACTION_NOTICE,
  type ToolResultFormat,
} from "./tool-transcript";

const responsesToolResultFormat: ToolResultFormat<Record<string, unknown>> = {
  isToolResult: (item) => item.type === "function_call_output",
  estimateChars: (item) => JSON.stringify(item).length + 8,
  isElided: (item) => item.output === TOOL_RESULT_COMPACTION_NOTICE,
  elide: (item) => {
    item.output = TOOL_RESULT_COMPACTION_NOTICE;
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
