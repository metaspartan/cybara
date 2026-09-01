import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

describe("modal footer wiring", () => {
  test("keeps bot form actions outside the scrolling form body", () => {
    const modal = readFileSync(resolve(root, "ui/src/components/ui/Modal.tsx"), "utf8");
    const sidebar = readFileSync(resolve(root, "ui/src/pages/chat/BotSidebar.tsx"), "utf8");
    expect(modal).toContain("footer?: React.ReactNode");
    expect(modal).toContain("relative shrink-0 border-t");
    expect(sidebar).toContain('form="create-bot-form"');
    expect(sidebar).toContain('form="edit-bot-form"');
    expect(sidebar).not.toContain("sticky -bottom-6");
  });
});
