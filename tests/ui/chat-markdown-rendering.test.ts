import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readUiStylesSource } from "../shared/source-bundles";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const messageContentPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/MessageContent.tsx", import.meta.url)
);
const activityTimelinePath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ActivityTimeline.tsx", import.meta.url)
);
const mermaidCodeBlockPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/MermaidCodeBlock.tsx", import.meta.url)
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

  test("renders Mermaid fences with themed preview and source tabs", () => {
    const messageSource = readFileSync(messageContentPath, "utf8");
    const mermaidSource = readFileSync(mermaidCodeBlockPath, "utf8");

    expect(messageSource).toContain('if (language === "mermaid")');
    expect(messageSource).toContain("<MermaidCodeBlock");
    expect(mermaidSource).toContain('import mermaid from "mermaid"');
    expect(mermaidSource).toContain('securityLevel: "strict"');
    expect(mermaidSource).toContain("new MutationObserver(syncTheme)");
    expect(mermaidSource).toContain('attributeFilter: ["class", "data-theme-mode"]');
    expect(mermaidSource).toContain('theme: lightTheme ? "default" : "dark"');
    expect(mermaidSource).toContain("bg-[var(--surface-panel,#11131c)]");
    expect(mermaidSource).toContain('role="tablist"');
    expect(mermaidSource).toContain('(["preview", "code"] as MermaidView[])');
    expect(mermaidSource).toContain("Rendering diagram...");
  });

  test("renders accessible inline and display LaTeX with theme-aware KaTeX", () => {
    const source = readFileSync(messageContentPath, "utf8");
    const styles = readUiStylesSource();

    expect(source).toContain('import rehypeKatex from "rehype-katex"');
    expect(source).toContain('import remarkMath from "remark-math"');
    expect(source).toContain('import "katex/dist/katex.min.css"');
    expect(source).toContain("remarkPlugins={[remarkGfm, remarkMath]}");
    expect(source).toContain('output: "htmlAndMathml"');
    expect(source).toContain("trust: false");
    expect(source).toContain('className="chat-markdown');
    expect(source).not.toContain("chat-markdown max-w-none text-[12px]");
    expect(styles).toContain(".chat-markdown .katex-display");
    expect(styles).toContain("font-size: var(--chat-font-size, 14px)");
    expect(styles).toContain("background: var(--surface-panel, #11131c)");
    expect(styles).toContain("color: inherit");
  });

  test("renders blockquotes with the active theme accent", () => {
    const source = readFileSync(messageContentPath, "utf8");

    expect(source).toContain('style={{ borderColor: "rgb(var(--accent-primary))" }}');
    expect(source).toContain("text-[var(--text-muted)]");
    expect(source).not.toContain("border-indigo-500");
  });

  test("renders activity thoughts with inline markdown and neutral status icons", () => {
    const source = readFileSync(activityTimelinePath, "utf8");

    expect(source).toContain("part.slice(2, -2)");
    expect(source).toContain("<strong");
    expect(source).toContain("<LiveStatusIndicator");
    expect(source).toContain("text-current opacity-70");
    expect(source).toContain("chat-thought-text");
    expect(source).toContain("chat-activity-text");
    expect(source).not.toContain("bg-current opacity-70");
    expect(source).not.toContain("Sparkles");
    expect(source).not.toContain("text-indigo-300");
    expect(source).not.toContain("text-emerald-400 mt-0.5");
    expect(source).toContain("edit: Pencil");
    expect(source).toContain("read: FileText");
    expect(source).toContain("search: Search");
    expect(source).toContain("command: SquareTerminal");
    expect(source).toContain("const GroupIcon = GROUP_ICONS[entry.kind]");
  });
});
