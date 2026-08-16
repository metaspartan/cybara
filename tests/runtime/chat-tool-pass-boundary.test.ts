import { describe, expect, test } from "bun:test";
import { readChatRuntimeSource } from "../source-fixtures";

describe("chat tool pass boundary", () => {
  test("limits post-wait synthesis tools to forced plan reconciliation", () => {
    const source = readChatRuntimeSource();

    expect(source).not.toContain("If more actions are needed to fully complete");
    expect(source).not.toContain("summaryToolPolicy");
    expect(source).toContain(
      "return { responseContent: options.responseContent, toolResults: [] }"
    );
    expect(source).toContain("Write the final user-facing response for the latest request");
    expect(source).toContain('allowedToolNames: shouldReconcileTodo ? ["todo"] : undefined');
    expect(source).toContain('requiredToolName: shouldReconcileTodo ? "todo" : undefined');
  });
});
