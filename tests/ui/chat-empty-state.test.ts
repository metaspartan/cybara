import { describe, expect, test } from "bun:test";

describe("chat empty state", () => {
  test("uses the transparent monochrome Cybara mark", async () => {
    const source = await Bun.file("ui/src/pages/Chat.tsx").text();

    expect(source).toContain('src="/cybara.png"');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain("grayscale brightness-[1.7] contrast-150");
    expect(source).not.toContain('<Sparkles className="mx-auto mb-3');
  });
});
