/**
 * Keep the OpenAI Codex Responses transcript under the model's input budget on
 * long multi-tool runs. Deep tasks (a "review this repo in depth" with hundreds
 * of tool calls) otherwise grow `inputItems` unbounded until the provider
 * rejects the request mid-stream.
 *
 * The Codex Responses API validates that every `function_call_output` has a
 * matching `function_call` with the same call_id (and rejects the request with
 * "No tool call found for function call output" otherwise). So we evict the
 * OLDEST COMPLETE call/output pairs together — never orphaning either half —
 * while preserving the leading user request and all recent turns.
 */
function callIdOf(item: Record<string, unknown>): string | undefined {
  const id = item.call_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function compactCodexInputItemsForContext(
  inputItems: Array<Record<string, unknown>>,
  budgetChars: number
): void {
  const estimate = () => inputItems.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
  if (estimate() <= budgetChars) return;

  let removedPairs = 0;
  // Evict from the front (oldest), skipping the leading anchor at index 0.
  while (estimate() > budgetChars && inputItems.length > 6) {
    const callIndex = inputItems.findIndex(
      (item, i) => i > 0 && item.type === "function_call" && callIdOf(item)
    );
    if (callIndex === -1) break;
    const callId = callIdOf(inputItems[callIndex]);

    // Remove the matching output first (index shifts if it precedes the call
    // are impossible — outputs always follow their call — but resolve by id to
    // be safe), then the call itself. Splice high-to-low to keep indices valid.
    const outputIndex = inputItems.findIndex(
      (item) => item.type === "function_call_output" && callIdOf(item) === callId
    );
    const toRemove = [callIndex, outputIndex].filter((i) => i >= 0).sort((a, b) => b - a);
    for (const i of toRemove) inputItems.splice(i, 1);
    removedPairs++;
  }

  // Safety net: drop any now-orphaned outputs whose call was already evicted
  // (or whose call_id no longer resolves), since the provider rejects those.
  const liveCallIds = new Set(
    inputItems
      .filter((item) => item.type === "function_call")
      .map(callIdOf)
      .filter(Boolean)
  );
  for (let i = inputItems.length - 1; i >= 0; i--) {
    const item = inputItems[i];
    if (item.type === "function_call_output" && !liveCallIds.has(callIdOf(item))) {
      inputItems.splice(i, 1);
    }
  }

  if (removedPairs > 0) {
    console.warn(
      `[Agent] Codex context trim: dropped ${removedPairs} old tool call/output pair(s) to stay under the input budget`
    );
  }
}

/**
 * Guarantee the Codex Responses `input` array is protocol-valid before it is
 * sent: every `function_call_output` must be preceded by a `function_call`
 * with the same call_id, or the API rejects the whole request ("No tool call
 * found for function call output"). Returns the count of repairs so callers
 * can log the root cause. Mutates in place.
 */
export function sanitizeCodexInputItems(inputItems: Array<Record<string, unknown>>): {
  droppedOutputs: number;
  droppedCalls: number;
} {
  const idOf = (item: Record<string, unknown>): string | undefined => {
    const id = item.call_id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  };

  // call_ids that have appeared as a function_call up to each point.
  const seenCallIds = new Set<string>();
  const callIdsWithOutput = new Set<string>();
  let droppedOutputs = 0;
  for (let i = 0; i < inputItems.length; i++) {
    const item = inputItems[i];
    if (item.type === "function_call") {
      const id = idOf(item);
      if (id) seenCallIds.add(id);
    } else if (item.type === "function_call_output") {
      const id = idOf(item);
      // Reject an output with no matching earlier call, or a duplicate output.
      if (!id || !seenCallIds.has(id) || callIdsWithOutput.has(id)) {
        inputItems.splice(i, 1);
        i--;
        droppedOutputs++;
        continue;
      }
      callIdsWithOutput.add(id);
    }
  }

  return { droppedOutputs, droppedCalls: 0 };
}
