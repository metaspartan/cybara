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

export const WEB_RESEARCH_SYNTHESIS_INSTRUCTION =
  "You have enough web research for this turn. Answer the user now from the strongest sources already collected. Do not call more tools. Briefly note any unresolved source limitation instead of retrying blocked or missing URLs.";
