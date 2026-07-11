import { describe, expect, test } from "bun:test";
import {
  countWebResearchCalls,
  DEFAULT_WEB_RESEARCH_TOOL_BUDGET,
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
    expect(WEB_RESEARCH_SYNTHESIS_INSTRUCTION).toContain("Do not call more tools");
  });

  test("clamps invalid custom budgets", () => {
    expect(webResearchBudgetReached(0, 0)).toBe(false);
    expect(webResearchBudgetReached(1, 0)).toBe(true);
  });
});
