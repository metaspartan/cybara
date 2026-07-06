import {
  assertResponsesToolPairing,
  compactToolTranscriptInPlace,
  TOOL_RESULT_COMPACTION_NOTICE,
  type ToolResultFormat,
} from "./tool-transcript";

/**
 * OpenAI Responses wire format (used by OAuth GPT / "codex" provider configs):
 * tool results are `function_call_output` items. Compaction elides the
 * `output` field in place so the matching `function_call` is never orphaned.
 * This is a thin format adapter over the shared, provider-agnostic compactor.
 */
const responsesToolResultFormat: ToolResultFormat<Record<string, unknown>> = {
  isToolResult: (item) => item.type === "function_call_output",
  estimateChars: (item) => JSON.stringify(item).length + 8,
  isElided: (item) => item.output === TOOL_RESULT_COMPACTION_NOTICE,
  elide: (item) => {
    item.output = TOOL_RESULT_COMPACTION_NOTICE;
  },
};

/** Keep the Responses `input` array under the model's input budget. */
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

/** Defense-in-depth pairing check before sending a Responses request. */
export function sanitizeCodexInputItems(inputItems: Array<Record<string, unknown>>): {
  droppedOutputs: number;
} {
  return { droppedOutputs: assertResponsesToolPairing(inputItems) };
}
