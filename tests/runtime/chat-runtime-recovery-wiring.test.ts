import { describe, expect, test } from "bun:test";

describe("chat runtime recovery wiring", () => {
  test("gateway startup restores pending turns and active goals", async () => {
    const source = await Bun.file(new URL("../../src/index.ts", import.meta.url)).text();

    expect(source).toContain(
      'import { startPersistedChatRuntimeRecovery } from "./api/chat-runtime-recovery";'
    );
    expect(source).toContain("startPersistedChatRuntimeRecovery();");
  });
});
