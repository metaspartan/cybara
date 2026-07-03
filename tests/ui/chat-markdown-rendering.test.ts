import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const messageContentPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/MessageContent.tsx", import.meta.url)
);

function readChatSource(): string {
  return readFileSync(chatPagePath, "utf8") + readFileSync(messageContentPath, "utf8");
}

describe("Chat markdown rendering behavior", () => {
  test("keeps inline code simple and does not render inline copy controls", () => {
    const source = readChatSource();

    expect(source).toContain("function InlineCodeSnippet");
    expect(source).not.toContain("Copy inline code");
    expect(source).not.toContain("Failed to copy inline code");
  });

  test("treats unlabelled unified patches as diff blocks", () => {
    const source = readChatSource();

    expect(source).toContain("function looksLikeDiffCode");
    expect(source).toContain('trimmed.startsWith("diff --git")');
    expect(source).toContain("if (looksLikeDiffCode(rawCode, language))");
    expect(source).toContain("return <DiffCodeBlock code={rawCode} />;");
  });

  test("runs markdown preprocessing before render", () => {
    const source = readChatSource();

    expect(source).toContain("preprocessChatMarkdown");
    expect(source).toContain(
      "const cleanedContent = useMemo(() => preprocessChatMarkdown(content), [content]);"
    );
    expect(source).toContain("{cleanedContent}");
  });
});
