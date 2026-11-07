import { describe, expect, test } from "bun:test";
import { discoverCursorModels, parseCursorModels } from "../../src/core/cursor-models";

const PICKER_BODY = {
  models: [
    {
      name: "grok-4.7",
      clientDisplayName: "Grok 4.7",
      supportsThinking: true,
      supportsImages: false,
      contextTokenLimit: 256000,
      contextTokenLimitForMaxMode: 500000,
      legacySlugs: ["grok-4.7"],
      variants: [
        {
          legacySlug: "grok-4.7-low",
          parameterValues: [
            { id: "context", value: "256k" },
            { id: "reasoning_effort", value: "low" },
            { id: "fast", value: "false" },
          ],
        },
        {
          legacySlug: "grok-4.7-high-fast",
          parameterValues: [
            { id: "context", value: "256k" },
            { id: "reasoning_effort", value: "high" },
            { id: "fast", value: "true" },
          ],
        },
      ],
    },
    {
      name: "claude-opus-5",
      clientDisplayName: "Claude Opus 5",
      supportsThinking: true,
      supportsImages: true,
      contextTokenLimit: 300000,
      contextTokenLimitForMaxMode: 1000000,
      variants: [
        {
          legacySlug: "claude-opus-5-high",
          parameterValues: [
            { id: "thinking", value: "false" },
            { id: "context", value: "300k" },
            { id: "effort", value: "high" },
            { id: "fast", value: "false" },
          ],
        },
        {
          legacySlug: "claude-opus-5-thinking-xhigh",
          parameterValues: [
            { id: "thinking", value: "true" },
            { id: "context", value: "1m" },
            { id: "effort", value: "xhigh" },
            { id: "fast", value: "false" },
          ],
        },
      ],
    },
    {
      name: "retired-model",
      isHidden: true,
      clientDisplayName: "Retired",
      variants: [{ legacySlug: "retired-model" }],
    },
  ],
};

describe("parseCursorModels", () => {
  test("expands each picker variant into its own model", () => {
    const models = parseCursorModels(PICKER_BODY);
    const ids = models.map((model) => model.id);
    expect(ids).toContain("grok-4.7-low");
    expect(ids).toContain("grok-4.7-high-fast");
    expect(ids).toContain("claude-opus-5-high");
    expect(ids).toContain("claude-opus-5-thinking-xhigh");
  });

  test("keeps the model id and the ids Cursor kept for older selections", () => {
    const ids = parseCursorModels(PICKER_BODY).map((model) => model.id);
    expect(ids).toContain("grok-4.7");
    expect(ids).toContain("claude-opus-5");
  });

  test("leaves out models Cursor hides", () => {
    const ids = parseCursorModels(PICKER_BODY).map((model) => model.id);
    expect(ids).not.toContain("retired-model");
  });

  test("reads the context window each variant runs at", () => {
    const models = parseCursorModels(PICKER_BODY);
    expect(models.find((model) => model.id === "grok-4.7-low")?.contextWindow).toBe(256000);
    expect(models.find((model) => model.id === "claude-opus-5-high")?.contextWindow).toBe(300000);
    expect(models.find((model) => model.id === "claude-opus-5-thinking-xhigh")?.contextWindow).toBe(
      1000000
    );
  });

  test("names a variant with its effort and speed", () => {
    const models = parseCursorModels(PICKER_BODY);
    expect(models.find((model) => model.id === "grok-4.7-low")?.name).toBe("Grok 4.7 Low");
    expect(models.find((model) => model.id === "grok-4.7-high-fast")?.name).toBe(
      "Grok 4.7 High Fast"
    );
    expect(models.find((model) => model.id === "claude-opus-5-high")?.name).toBe(
      "Claude Opus 5 High No Thinking"
    );
    expect(models.find((model) => model.id === "claude-opus-5-thinking-xhigh")?.name).toBe(
      "Claude Opus 5 Extra High Thinking"
    );
  });

  test("records reasoning and image support per model", () => {
    const models = parseCursorModels(PICKER_BODY);
    expect(models.find((model) => model.id === "grok-4.7-low")?.reasoning).toBe(true);
    expect(models.find((model) => model.id === "grok-4.7-low")?.input).toEqual(["text"]);
    expect(models.find((model) => model.id === "claude-opus-5-high")?.input).toEqual([
      "text",
      "image",
    ]);
  });

  test("returns nothing for a payload without models", () => {
    expect(parseCursorModels({})).toEqual([]);
    expect(parseCursorModels(null)).toEqual([]);
  });
});

describe("discoverCursorModels", () => {
  test("asks Cursor's model picker and its usable list for the account's models", async () => {
    const requested: string[] = [];
    const models = await discoverCursorModels("token", (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("GetUsableModels")) {
        return Response.json({ models: [{ modelId: "grok-4.7-high" }] });
      }
      return Response.json(PICKER_BODY);
    }) as typeof fetch);
    expect(requested).toContain("https://api2.cursor.sh/aiserver.v1.AiService/AvailableModels");
    expect(requested).toContain("https://api2.cursor.sh/agent.v1.AgentService/GetUsableModels");
    expect(models.length).toBeGreaterThan(0);
  });

  test("adds the models the account can run that the picker leaves out", async () => {
    const models = await discoverCursorModels("token", (async (input: RequestInfo | URL) => {
      if (String(input).includes("GetUsableModels")) {
        return Response.json({ models: [{ modelId: "cursor-grok-4.6-high" }] });
      }
      return Response.json(PICKER_BODY);
    }) as typeof fetch);
    expect(models.map((model) => model.id)).toContain("cursor-grok-4.6");
  });

  test("still lists the picker models when the usable list is refused", async () => {
    const models = await discoverCursorModels("token", (async (input: RequestInfo | URL) => {
      if (String(input).includes("GetUsableModels")) {
        return new Response("", { status: 401 });
      }
      return Response.json(PICKER_BODY);
    }) as typeof fetch);
    expect(models.map((model) => model.id)).toContain("grok-4.7-low");
  });

  test("fails when Cursor refuses the request", async () => {
    await expect(
      discoverCursorModels("token", (async () => new Response("", { status: 401 })) as typeof fetch)
    ).rejects.toThrow("Cursor model discovery returned 401");
  });
});
