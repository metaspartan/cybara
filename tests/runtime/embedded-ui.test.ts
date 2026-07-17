import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { getEmbeddedUiBundle, readEmbeddedUiIndex } from "../../src/core/runtime/embedded-ui";

interface EmbeddedUiTestGlobal {
  __CYBARA_EMBEDDED_UI__?: unknown;
}

const runtime = globalThis as typeof globalThis & EmbeddedUiTestGlobal;

afterEach(() => {
  delete runtime.__CYBARA_EMBEDDED_UI__;
});

describe("embedded UI", () => {
  test("accepts a complete generated bundle", () => {
    runtime.__CYBARA_EMBEDDED_UI__ = {
      indexPath: "/$bunfs/root/index.html",
      assets: { "/assets/app.js": "/$bunfs/root/app.js" },
    };

    expect(getEmbeddedUiBundle()).toEqual({
      indexPath: "/$bunfs/root/index.html",
      assets: { "/assets/app.js": "/$bunfs/root/app.js" },
    });
  });

  test("rejects malformed generated bundles", () => {
    runtime.__CYBARA_EMBEDDED_UI__ = {
      indexPath: "/$bunfs/root/index.html",
      assets: { "/assets/app.js": 42 },
    };

    expect(getEmbeddedUiBundle()).toBeUndefined();
  });

  test("reads the embedded index and tolerates inaccessible assets", () => {
    const bundle = { indexPath: "/embedded/index.html", assets: {} };
    const read = ((_path: string, _encoding: BufferEncoding) =>
      "<main>Cybara</main>") as typeof readFileSync;
    expect(readEmbeddedUiIndex(bundle, read)).toBe("<main>Cybara</main>");
    expect(
      readEmbeddedUiIndex(bundle, (() => {
        throw new Error("missing");
      }) as typeof readFileSync)
    ).toBeUndefined();
  });
});
