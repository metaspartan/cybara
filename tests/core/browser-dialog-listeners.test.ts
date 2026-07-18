import { describe, expect, test } from "bun:test";

describe("browser dialog actions", () => {
  test("install one-shot rejection-safe listeners", async () => {
    const source = await Bun.file("src/core/browser/pw-manager.ts").text();
    const accept = source.slice(source.indexOf("export async function acceptDialog"));
    const section = accept.slice(0, accept.indexOf("export async function evaluate"));
    expect(section.match(/page\.onceDialog\(/g)).toHaveLength(2);
    expect(section).not.toContain("page.onDialog");
    expect(section.match(/\.catch\(\(\) => undefined\)/g)).toHaveLength(2);
  });
});
