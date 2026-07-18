import { describe, expect, test } from "bun:test";
import {
  appendToolImageReferences,
  extractAutomaticMemoryContent,
} from "../../src/api/chat-response-enrichment";

describe("chat response enrichment", () => {
  test("adds unique tool image references without duplicating existing images", () => {
    const content = appendToolImageReferences("Done", [
      { id: "1", name: "browser_screenshot", result: { filePath: "/tmp/result.png" } },
      { id: "2", name: "computer_screenshot", result: { filePath: "/tmp/result.png" } },
      { id: "3", name: "write", result: { filePath: "/tmp/result.txt" } },
    ]);
    expect(content).toBe("Done\n\n![screenshot](file:///tmp/result.png)");
    expect(
      appendToolImageReferences(content, [
        { id: "4", name: "browser_screenshot", result: { filePath: "/tmp/result.png" } },
      ])
    ).toBe(content);
  });

  test("extracts bounded explicit memory requests", () => {
    expect(extractAutomaticMemoryContent("Remember that my editor is Zed")).toBe(
      "my editor is Zed"
    );
    expect(extractAutomaticMemoryContent("Remember x")).toBeNull();
    expect(extractAutomaticMemoryContent(`Remember ${"x".repeat(500)}`)).toBeNull();
    expect(extractAutomaticMemoryContent("This is ordinary chat")).toBeNull();
  });
});
