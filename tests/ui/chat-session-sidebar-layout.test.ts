import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const chatSource = () =>
  readFileSync(join(process.cwd(), "ui", "src", "pages", "Chat.tsx"), "utf8");

describe("chat session sidebar layout", () => {
  test("lets session text use the full row width while actions float above it", () => {
    const source = chatSource();

    expect(source).toContain("const SESSION_PREVIEW_LIMIT = 160");
    expect(source).toContain("function sessionPreviewText");
    expect(source).toContain('content.replace(/\\s+/g, " ").trim()');
    expect(source).toContain("sessionPreviewText(session.last_message?.content)?.toLowerCase()");
    expect(source).toContain(
      "const previewText = sessionPreviewText(session.last_message?.content)"
    );
    expect(source).toContain("deferred-list-row relative p-2.5");
    expect(source).toContain('className="min-w-0 w-full"');
    expect(source).toContain('className="text-[12px] text-white font-medium flex w-full min-w-0');
    expect(source).toContain('className="min-w-0 flex-1 truncate">{displayTitle}</span>');
    expect(source).toContain("absolute right-2 top-2");
    expect(source).toContain("pointer-events-none");
    expect(source).toContain("group-hover:pointer-events-auto");
    expect(source).toContain("group-focus-within:pointer-events-auto");
    expect(source).not.toContain(
      'session.pinned\n                            ? "pointer-events-auto opacity-100"'
    );
    expect(source).not.toContain("session.last_message.content");
  });
});
