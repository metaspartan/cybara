const WEB_RESEARCH_TOOL_NAMES = new Set(["web_search", "web_fetch"]);

export const DEFAULT_WEB_RESEARCH_TOOL_BUDGET = 12;

export function countWebResearchCalls(toolNames: string[]): number {
  return toolNames.filter((name) => WEB_RESEARCH_TOOL_NAMES.has(name)).length;
}

export function webResearchBudgetReached(
  completedCalls: number,
  budget = DEFAULT_WEB_RESEARCH_TOOL_BUDGET
): boolean {
  return completedCalls >= Math.max(1, budget);
}

export function toolsAfterWebResearchBudget<T extends { name: string }>(
  tools: T[],
  budgetReached: boolean
): T[] {
  if (!budgetReached) return tools;
  return tools.filter((tool) => !WEB_RESEARCH_TOOL_NAMES.has(tool.name));
}

export const WEB_RESEARCH_SYNTHESIS_INSTRUCTION =
  "The web research budget for this turn is complete. Do not call web_search or web_fetch again. Use the strongest sources already collected, finish and verify every required deliverable with available non-web tools, and briefly note unresolved source limitations in the final response.";
