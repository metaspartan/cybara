import { describe, expect, test } from "bun:test";
import { preprocessChatMarkdown } from "../../ui/src/lib/chatMarkdownPreprocessor";

describe("chat markdown preprocessor", () => {
  test("strips inbound untrusted metadata blocks", () => {
    const markdown = `
Conversation info (untrusted metadata):
\`\`\`json
{"message_id":"123","sender":"test"}
\`\`\`

Sender (untrusted metadata):
\`\`\`json
{"label":"Razor"}
\`\`\`

Razor?
`.trim();

    expect(preprocessChatMarkdown(markdown)).toBe("Razor?");
  });

  test("strips prefixed timestamps", () => {
    const markdown = "[Fri 2026-02-20 18:45 GMT+1] How's it going?";
    expect(preprocessChatMarkdown(markdown)).toBe("How's it going?");
  });

  test("keeps non-metadata fenced json", () => {
    const markdown = `
Here is some json:
\`\`\`json
{"x":1}
\`\`\`
`.trim();

    expect(preprocessChatMarkdown(markdown)).toBe(markdown);
  });

  test("normalizes line endings and excessive vertical spacing", () => {
    const markdown = "Line 1\r\n\r\n\r\nLine 2\r\n\r\n\r\nLine 3";
    expect(preprocessChatMarkdown(markdown)).toBe("Line 1\n\nLine 2\n\nLine 3");
  });

  test("normalizes model-style LaTeX delimiters without touching code", () => {
    const markdown = "Solve \\(x + 1\\) but keep `\\(raw\\)` unchanged.";
    expect(preprocessChatMarkdown(markdown)).toBe("Solve $x + 1$ but keep `\\(raw\\)` unchanged.");
  });
});
