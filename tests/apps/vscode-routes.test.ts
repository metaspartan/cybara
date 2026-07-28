import { describe, expect, test } from "bun:test";
import { buildCybaraRouteUrl } from "../../apps/vscode/src/routes";

describe("VS Code Cybara routes", () => {
  test("opens IDE files using the web IDE contract", () => {
    expect(
      buildCybaraRouteUrl("http://127.0.0.1:4269/", "/ide", {
        workspacePath: "/work/repo",
        filePath: "/work/repo/src/main.ts",
        line: 23,
      })
    ).toBe(
      "http://127.0.0.1:4269/ide?workspacePath=%2Fwork%2Frepo&path=%2Fwork%2Frepo%2Fsrc%2Fmain.ts&line=23"
    );
  });

  test("keeps chat workspace routing backward compatible", () => {
    expect(
      buildCybaraRouteUrl("http://127.0.0.1:4269", "/chat", {
        workspacePath: "C:\\work\\repo",
      })
    ).toBe("http://127.0.0.1:4269/chat?workspace=C%3A%5Cwork%5Crepo");
  });
});
