import { describe, expect, test } from "bun:test";
import {
  isGatewayFailureBody,
  measureRequestShape,
  uncachedPromptTokens,
  emptyUsage,
} from "../../scripts/harness-benchmark-core";
import { buildSystemPrompt } from "../../src/core/system-prompt";
import { trackOpenAIResponseUsage } from "../../src/core/llm/openai-response-usage";
import { summarizeSessionTokenUsage } from "../../src/core/session-context";
import type { OpenAIUsage } from "../../src/core/agent-internals";

const tools = [
  {
    type: "function",
    function: { name: "read", description: "Read a file", parameters: { type: "object" } },
  },
];

describe("metadata-only request efficiency telemetry", () => {
  test("stable prefix ignores changing user turns but detects a tool schema or system change", () => {
    const body = {
      tools,
      messages: [
        { role: "system", content: "Stable policy" },
        { role: "user", content: "secret-a" },
      ],
      reasoning_effort: "high",
      max_tokens: 4000,
    };
    const first = measureRequestShape(body);
    const changed = measureRequestShape({
      ...body,
      messages: [
        { role: "system", content: "Stable policy" },
        { role: "user", content: "secret-b" },
      ],
    });
    expect(first.stable_prefix_sha256).toBe(changed.stable_prefix_sha256);
    expect(measureRequestShape({ ...body, tools: [] }).stable_prefix_sha256).not.toBe(
      first.stable_prefix_sha256
    );
    expect(
      measureRequestShape({ ...body, messages: [{ role: "system", content: "Different policy" }] })
        .stable_prefix_sha256
    ).not.toBe(first.stable_prefix_sha256);
    expect(first).toMatchObject({
      tools_count: 1,
      messages_count: 2,
      system_chars: 13,
      reasoning_effort: "high",
      max_output_tokens: 4000,
    });
    expect(JSON.stringify(first)).not.toContain("secret-a");
    expect(JSON.stringify(first)).not.toContain("Stable policy");
  });

  test("counts UTF-8 bytes and marks unknown effort/cache values unknown", () => {
    const body = { messages: [{ role: "system", content: "é🌻" }], reasoning_effort: "invalid" };
    expect(measureRequestShape(body).request_bytes).toBe(Buffer.byteLength(JSON.stringify(body)));
    expect(measureRequestShape(body).system_chars).toBe(3);
    expect(measureRequestShape(body).reasoning_effort).toBeNull();
    expect(
      measureRequestShape({ reasoning: { effort: "high" }, max_completion_tokens: 200 })
        .max_output_tokens
    ).toBe(200);
    expect(uncachedPromptTokens(null)).toBeNull();
    expect(uncachedPromptTokens({ ...emptyUsage(), prompt_tokens: 100 })).toBeNull();
    expect(
      uncachedPromptTokens({ ...emptyUsage(), prompt_tokens: 100, cache_read_tokens: 70 })
    ).toBe(30);
  });

  test("classifies failure bodies independently of successful HTTP status without leaking errors", () => {
    expect(isGatewayFailureBody({ success: true })).toBe(false);
    expect(isGatewayFailureBody({ success: false })).toBe(true);
    expect(isGatewayFailureBody({ failure: { message: "private-secret" } })).toBe(true);
    expect(isGatewayFailureBody({ error: "private-secret" })).toBe(true);
    expect(isGatewayFailureBody({ error: [] })).toBe(false);
    expect(isGatewayFailureBody(null)).toBe(false);
  });
});

describe("included compatible prompt-cache usage", () => {
  for (const alias of [
    "cache_read_tokens",
    "prompt_cache_hit_tokens",
    "input_tokens_details",
  ] as const) {
    test(`records ${alias} without counting cached input twice`, () => {
      const sessionId = `cache-alias-${crypto.randomUUID()}`;
      const usage: OpenAIUsage = {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        ...(alias === "input_tokens_details"
          ? { input_tokens_details: { cached_tokens: 60 } }
          : { [alias]: 60 }),
      };
      expect(
        trackOpenAIResponseUsage(
          { id: "cache", object: "chat.completion", model: "fixture", choices: [], usage },
          {
            model: "fixture",
            provider: "fixture",
            providerUrl: "http://127.0.0.1",
            durationMs: 100,
            sessionId,
          }
        )
      ).toBe(true);
      const totals = summarizeSessionTokenUsage(sessionId);
      expect(totals.inputTokens).toBe(100);
      expect(totals.cachedInputTokens).toBe(60);
      expect(totals.totalTokens).toBe(120);
    });
  }

  test("explicit standard cache details take precedence over aliases, including zero", () => {
    const sessionId = `cache-zero-${crypto.randomUUID()}`;
    trackOpenAIResponseUsage(
      {
        id: "cache",
        object: "chat.completion",
        model: "fixture",
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 0 },
          cache_read_tokens: 60,
        },
      },
      {
        model: "fixture",
        provider: "fixture",
        providerUrl: "http://127.0.0.1",
        durationMs: 100,
        sessionId,
      }
    );
    expect(summarizeSessionTokenUsage(sessionId).cachedInputTokens).toBe(0);
  });
});

describe("capability-scoped skill prompt", () => {
  const skill = {
    skill: {
      name: "fixture-workflow",
      description: "Fixture skill description",
      location: "/fixture/skill",
      instructions: "Fixture instructions",
    },
    frontmatter: { name: "fixture-workflow", description: "Fixture skill description" },
    filePath: "/fixture/skill/SKILL.md",
  };
  test("does not spend tokens on a skill catalog without a skill-loading capability", () => {
    const restricted = buildSystemPrompt({
      tools: ["read", "write", "exec"],
      modelDisplay: "fixture",
      skills: [skill],
    });
    expect(restricted).not.toContain("<available_skills>");
    expect(restricted).not.toContain("fixture-workflow");
    expect(restricted).not.toContain("## Skills");
    expect(restricted).toContain("## Safety");
    expect(restricted).toContain("real caller-visible evidence");
    const enabled = buildSystemPrompt({
      tools: ["read", "write", "exec", "skill_load"],
      modelDisplay: "fixture",
      skills: [skill],
    });
    expect(enabled).toContain("fixture-workflow");
    expect(enabled).toContain("<available_skills>");
  });
});
describe("efficient input inspection retains evidence requirements", () => {
  test("prompts directly scoped reads and safe batching without redundant discovery", () => {
    const prompt = buildSystemPrompt({ tools: ["read", "write", "exec"], modelDisplay: "fixture" });
    expect(prompt).toContain("Read exact input paths directly");
    expect(prompt).toContain("path as an array of up to 8 paths");
    expect(prompt).toContain("Independently recompute from inputs after writing");
    expect(prompt).toContain("real caller-visible evidence");
    expect(prompt).toContain("Do not invent files, state, results, or tool output");
    expect(buildSystemPrompt({ tools: [], modelDisplay: "fixture" })).not.toContain(
      "path as an array"
    );
  });
});
