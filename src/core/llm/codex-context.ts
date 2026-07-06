/**
 * Keep the OpenAI Codex Responses transcript under the model's input budget on
 * long multi-tool runs. Deep tasks (a "review this repo in depth" with hundreds
 * of tool calls) otherwise grow `inputItems` unbounded until the provider
 * rejects the request mid-stream. We evict the oldest function_call /
 * function_call_output pairs — the least useful history — while preserving the
 * leading user request and all recent turns, so the loop keeps going.
 */
export function compactCodexInputItemsForContext(
  inputItems: Array<Record<string, unknown>>,
  budgetChars: number
): void {
  const estimate = () => inputItems.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
  if (estimate() <= budgetChars) return;

  let removed = 0;
  while (estimate() > budgetChars && inputItems.length > 6) {
    const index = inputItems.findIndex(
      (item, i) => i > 0 && (item.type === "function_call" || item.type === "function_call_output")
    );
    if (index === -1) break;
    inputItems.splice(index, 1);
    removed++;
  }
  if (removed > 0) {
    console.warn(
      `[Agent] Codex context trim: dropped ${removed} old tool item(s) to stay under the input budget`
    );
  }
}
