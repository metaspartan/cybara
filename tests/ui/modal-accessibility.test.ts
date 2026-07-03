import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const modalSource = () =>
  readFileSync(join(process.cwd(), "ui", "src", "components", "ui", "Modal.tsx"), "utf8");

describe("modal accessibility", () => {
  test("uses dialog semantics, escape close handling, and a contained tab loop", () => {
    const source = modalSource();

    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("aria-labelledby={title ? titleId : undefined}");
    expect(source).toContain("aria-describedby={description ? descriptionId : undefined}");
    expect(source).toContain('aria-label="Close dialog"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain('document.addEventListener("keydown", handleKeyDown)');
    expect(source).toContain("previouslyFocused?.focus()");
  });
});
