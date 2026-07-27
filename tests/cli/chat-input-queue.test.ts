import { describe, expect, test } from "bun:test";
import { createChatInputQueue } from "../../src/cli/commands/chat-input-queue";

describe("CLI chat input serialization", () => {
  test("applies async commands before a pasted prompt", async () => {
    const events: string[] = [];
    let agent = "default";
    const enqueue = createChatInputQueue(
      async (input) => {
        if (input === "/agent Mini") {
          await Bun.sleep(20);
          agent = "Mini";
          events.push("agent");
          return;
        }
        events.push(`prompt:${agent}:${input}`);
      },
      () => undefined
    );

    enqueue("/agent Mini");
    enqueue("continue");
    await Bun.sleep(40);

    expect(events).toEqual(["agent", "prompt:Mini:continue"]);
  });

  test("continues processing after an input failure", async () => {
    const events: string[] = [];
    const errors: string[] = [];
    const enqueue = createChatInputQueue(
      async (input) => {
        if (input === "bad") throw new Error("failed");
        events.push(input);
      },
      (error) => errors.push(error instanceof Error ? error.message : String(error))
    );

    enqueue("bad");
    enqueue("next");
    await Bun.sleep(10);

    expect(errors).toEqual(["failed"]);
    expect(events).toEqual(["next"]);
  });
});
