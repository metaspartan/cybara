import { describe, expect, test } from "bun:test";

const patchPath = "apps/mobile/patches/image-size@1.2.1.patch";

describe("image-size denial-of-service patch", () => {
  test("apps/mobile pins the patched image-size build", async () => {
    const manifest = JSON.parse(await Bun.file("apps/mobile/package.json").text()) as {
      patchedDependencies?: Record<string, string>;
    };
    expect(manifest.patchedDependencies?.["image-size@1.2.1"]).toBe(
      "patches/image-size@1.2.1.patch"
    );
  });

  test("the patch guards both unbounded parser loops", async () => {
    const patch = await Bun.file(patchPath).text();
    expect(patch).toContain("dist/types/icns.js");
    expect(patch).toContain("imageHeader[1] > 0");
    expect(patch).toContain("dist/types/jxl.js");
    expect(patch).toContain("jxlpBox.size > 0");
  });

  test("a zero-length ICNS entry terminates instead of looping forever", () => {
    const script = [
      "const { imageSize } = require(process.argv[1]);",
      "const buffer = Buffer.alloc(32);",
      'buffer.write("icns", 0, "ascii");',
      "buffer.writeUInt32BE(32, 4);",
      'buffer.write("ic07", 8, "ascii");',
      "buffer.writeUInt32BE(0, 12);",
      "try { imageSize(buffer); } catch {}",
      'process.stdout.write("terminated");',
    ].join("\n");

    const result = Bun.spawnSync(
      ["node", "-e", script, `${process.cwd()}/apps/mobile/node_modules/image-size/dist/index.js`],
      { timeout: 15_000 }
    );

    expect(result.stdout.toString()).toContain("terminated");
  }, 20_000);
});
