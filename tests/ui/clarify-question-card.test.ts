import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleClarify } from "../../src/core/tools/handlers/clarify";
import {
  interruptionCategoryReason,
  interruptedResponseText,
} from "../../src/api/chat-interruption";
import { clarifyQuestionFromToolCalls } from "../../ui/src/pages/chat/ClarifyQuestionCard";

const cardSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ClarifyQuestionCard.tsx", import.meta.url)),
  "utf8"
);
const timelineSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatMessageTimeline.tsx", import.meta.url)),
  "utf8"
);
const providerFailureSource = readFileSync(
  fileURLToPath(new URL("../../src/api/chat-provider-failure.ts", import.meta.url)),
  "utf8"
);

describe("clarify question card", () => {
  test("parses a completed clarify tool call into an interactive question", () => {
    const question = clarifyQuestionFromToolCalls([
      { name: "read", status: "completed", result: { content: "hi" } },
      {
        name: "clarify",
        status: "completed",
        result: {
          question: "Which runtime should I target?",
          header: "Setup",
          multiSelect: false,
          options: [{ label: "Bun", description: "Fast installs" }, { label: "Node" }],
        },
      },
    ]);
    expect(question).toEqual({
      question: "Which runtime should I target?",
      header: "Setup",
      multiSelect: false,
      options: [
        { label: "Bun", description: "Fast installs" },
        { label: "Node", description: undefined },
      ],
    });
    expect(
      clarifyQuestionFromToolCalls([{ name: "clarify", result: { question: "" } }])
    ).toBeNull();
    expect(clarifyQuestionFromToolCalls([{ name: "clarify", result: null }])).toBeNull();
    expect(clarifyQuestionFromToolCalls(undefined)).toBeNull();
  });

  test("card renders options, free-text input, and an answer action", () => {
    expect(cardSource).toContain('data-testid="clarify-question-card"');
    expect(cardSource).toContain('data-testid="clarify-question-option"');
    expect(cardSource).toContain('data-testid="clarify-question-input"');
    expect(cardSource).toContain('data-testid="clarify-question-send"');
    expect(cardSource).toContain('"Or type your own answer…"');
    expect(cardSource).toContain('apiFetch("/api/chat"');
    expect(cardSource).toContain("question.multiSelect ? current : []");
  });

  test("timeline shows the card only on the latest assistant entry", () => {
    expect(timelineSource).toContain("clarifyQuestionFromToolCalls(message.tool_calls)");
    expect(timelineSource).toContain("isLatestEntry");
    expect(timelineSource).toContain("isLatestEntry: visibleIndex === entries.length - 1");
  });
});

describe("clarify tool handler", () => {
  test("keeps returning awaiting-user payloads with validated options", async () => {
    const result = await handleClarify({
      question: "Proceed with plan A or B?",
      header: "Direction",
      options: [
        { label: "Plan A", description: "Ship fast" },
        { label: "Plan B", description: "Ship safe" },
        { label: "  " },
      ],
    });
    expect(result).toMatchObject({
      question: "Proceed with plan A or B?",
      header: "Direction",
      multiSelect: false,
      awaiting: "user",
    });
    expect(result.options).toHaveLength(2);
    await expect(handleClarify({})).rejects.toThrow(/question.*required/i);
  });
});

describe("interrupted response reasons", () => {
  test("maps failure categories to human reasons", () => {
    expect(interruptionCategoryReason("rate_limit")).toBe(
      "the provider kept rate-limiting the request"
    );
    expect(interruptionCategoryReason("overloaded")).toBe("the provider was overloaded");
    expect(interruptionCategoryReason("mystery")).toBeUndefined();
    expect(interruptionCategoryReason(undefined)).toBeUndefined();
  });

  test("interrupted text embeds the known reason and falls back to the neutral copy", () => {
    expect(interruptedResponseText("the provider was overloaded")).toBe(
      "Response interrupted before completion — the provider was overloaded. Send the message again to retry."
    );
    expect(interruptedResponseText("   ")).toBe(interruptedResponseText());
    expect(interruptedResponseText()).toContain("Send the message again to retry.");
  });

  test("provider failure persistence prefers a reason over the neutral copy", () => {
    expect(providerFailureSource).toContain("interruptedResponseText(failureReason)");
    expect(providerFailureSource).toContain("interruptionCategoryReason(failure.category)");
    expect(providerFailureSource).not.toContain("content: INTERRUPTED_RESPONSE,");
  });
});
