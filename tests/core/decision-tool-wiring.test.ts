import { describe, expect, test } from "bun:test";
import { getToolHandler } from "../../src/core/tools";
import { getToolSchemasForLLM, toolSchemas } from "../../src/core/tools/registry";
import {
  getToolHandler as getRegisteredHandler,
  hasTool,
} from "../../src/core/tools/handlers/index";
import { resolveAgentToolPolicy } from "../../src/core/toolsets";
import type { ToolContext } from "../../src/core/tools/types";

function policyFor(tools: string[]) {
  return resolveAgentToolPolicy({
    profile: "full",
    toolsets: ["skills"],
    allowedToolNames: tools,
  } as never);
}

describe("decision tools are exposed to the model", () => {
  test("decision_evaluate and decision_list appear in the LLM tool schemas", () => {
    const names = getToolSchemasForLLM().map((tool) => tool.name);
    expect(names).toContain("decision_evaluate");
    expect(names).toContain("decision_list");
  });

  test("the evaluate schema describes the typed question contract", () => {
    const schema = toolSchemas.decision_evaluate;
    expect(schema.input_schema.required).toEqual(["state", "questions"]);
    const properties = schema.input_schema.properties as Record<string, { description?: string }>;
    expect(properties.state.description).toContain("evidence");
    expect(properties.questions.description).toContain("noul");
    expect(properties.questions.description).toContain("choice");
    expect(properties.questions.description).toContain("score");
  });

  test("the evaluate description states answers are evidence, not permission", () => {
    expect(toolSchemas.decision_evaluate.description).toContain("not permission to act");
  });

  test("the tools are reachable through the lazy tool handler map", async () => {
    const handler = getToolHandler("decision_evaluate");
    expect(handler).toBeDefined();
    const result = (await handler?.({
      state: "x",
      questions: { q: { type: "noul", instructions: "u" } },
    })) as {
      ok: boolean;
    };
    expect(result.ok).toBe(false);
  });

  test("the tools are registered in the eager handler map too", () => {
    expect(hasTool("decision_evaluate")).toBe(true);
    expect(hasTool("decision_list")).toBe(true);
    expect(getRegisteredHandler("decision_evaluate")).toBeDefined();
  });

  test("the skills toolset offers both decision tools", () => {
    const policy = policyFor(["decision_evaluate", "decision_list"]);
    expect(policy.valid).toBe(true);
    expect(policy.allowedToolNames).toContain("decision_evaluate");
    expect(policy.allowedToolNames).toContain("decision_list");
  });
});

describe("decision tool gating", () => {
  test("decision evaluation requires no elevated permission", () => {
    expect(toolSchemas.decision_evaluate.permissions).toEqual([]);
    expect(toolSchemas.decision_list.permissions).toEqual([]);
  });

  test("the handler does not require a tool context to run", async () => {
    const handler = getToolHandler("decision_list");
    const result = (await handler?.({}, undefined as unknown as ToolContext)) as {
      ok: boolean;
      models: unknown[];
    };
    expect(result.ok).toBe(true);
    expect(result.models.length).toBeGreaterThan(0);
  });
});
