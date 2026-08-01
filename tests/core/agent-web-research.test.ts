import { describe, expect, test } from "bun:test";
import {
  countWebResearchCalls,
  DEFAULT_WEB_RESEARCH_TOOL_BUDGET,
  toolsAfterWebResearchBudget,
  WEB_RESEARCH_SYNTHESIS_INSTRUCTION,
  webResearchBudgetReached,
} from "../../src/core/agent-web-research";

describe("agent web research budget", () => {
  test("counts discovery and fetch calls without limiting unrelated tools", () => {
    expect(countWebResearchCalls(["web_search", "read", "web_fetch", "browser", "exec"])).toBe(2);
  });

  test("forces synthesis at the default boundary", () => {
    expect(webResearchBudgetReached(DEFAULT_WEB_RESEARCH_TOOL_BUDGET - 1)).toBe(false);
    expect(webResearchBudgetReached(DEFAULT_WEB_RESEARCH_TOOL_BUDGET)).toBe(true);
    expect(WEB_RESEARCH_SYNTHESIS_INSTRUCTION).toContain(
      "continue with available non-web tools"
    );
  });

  test("removes only research tools after the budget is reached", () => {
    const tools = [
      { name: "web_search" },
      { name: "exec" },
      { name: "web_fetch" },
      { name: "write" },
    ];

    expect(toolsAfterWebResearchBudget(tools, false)).toEqual(tools);
    expect(toolsAfterWebResearchBudget(tools, true)).toEqual([
      { name: "exec" },
      { name: "write" },
    ]);
  });

  test("clamps invalid custom budgets", () => {
    expect(webResearchBudgetReached(0, 0)).toBe(false);
    expect(webResearchBudgetReached(1, 0)).toBe(true);
  });
});
