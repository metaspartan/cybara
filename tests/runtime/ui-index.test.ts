import { describe, expect, test } from "bun:test";
import { join } from "path";
import { readUiIndexContent } from "../../src/core/runtime/ui-index";

describe("UI index runtime loading", () => {
  test("reads the current dist index on every request", () => {
    let html = "<script src=\"/assets/old.js\"></script>";
    const reads: string[] = [];

    const readFileSyncFn = (path: string, encoding: BufferEncoding) => {
      reads.push(`${path}:${encoding}`);
      return html;
    };

    const uiPath = "/tmp/cybara-ui";
    expect(
      readUiIndexContent({
        uiPath,
        uiExists: true,
        fallbackContent: "fallback",
        readFileSyncFn,
      })
    ).toContain("old.js");

    html = "<script src=\"/assets/new.js\"></script>";

    expect(
      readUiIndexContent({
        uiPath,
        uiExists: true,
        fallbackContent: "fallback",
        readFileSyncFn,
      })
    ).toContain("new.js");
    expect(reads).toEqual([`${join(uiPath, "index.html")}:utf-8`, `${join(uiPath, "index.html")}:utf-8`]);
  });

  test("falls back when the UI index cannot be read", () => {
    const fallbackContent = "<h1>Cybara</h1>";

    expect(
      readUiIndexContent({
        uiPath: "/tmp/missing",
        uiExists: false,
        fallbackContent,
        readFileSyncFn: () => {
          throw new Error("should not read missing UI");
        },
      })
    ).toBe(fallbackContent);

    expect(
      readUiIndexContent({
        uiPath: "/tmp/broken",
        uiExists: true,
        fallbackContent,
        readFileSyncFn: () => {
          throw new Error("dist was rebuilt mid-request");
        },
      })
    ).toBe(fallbackContent);
  });
});
