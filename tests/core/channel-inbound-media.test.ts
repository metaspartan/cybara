import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildChannelImages,
  inlineChannelTextFile,
  channelFileIsImage,
} from "../../src/core/channels/inbound-media";

const dir = mkdtempSync(join(tmpdir(), "cybara-inbound-"));
const pngPath = join(dir, "shot.png");
const txtPath = join(dir, "notes.txt");
writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
writeFileSync(txtPath, "hello from a file");

describe("channel inbound media", () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("reads a local image file into base64 image", () => {
    const images = buildChannelImages({
      hasFile: true,
      filePath: pngPath,
      fileType: "image/png",
      placeholder: "",
    });
    expect(images).toHaveLength(1);
    expect(images[0].data).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
    expect(images[0].mimeType).toBe("image/png");
  });

  test("passes a remote image url through without reading disk", () => {
    const images = buildChannelImages({
      hasFile: true,
      filePath: "https://cdn.example.com/a.jpg",
      fileType: "image/jpeg",
      placeholder: "",
    });
    expect(images).toEqual([{ url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg" }]);
  });

  test("non-image file yields no images", () => {
    expect(
      buildChannelImages({
        hasFile: true,
        filePath: txtPath,
        fileType: "text/plain",
        placeholder: "",
      })
    ).toEqual([]);
    expect(
      channelFileIsImage({
        hasFile: true,
        filePath: txtPath,
        fileType: "text/plain",
        placeholder: "",
      })
    ).toBe(false);
  });

  test("inlines text file content, not images", () => {
    const inlined = inlineChannelTextFile({
      hasFile: true,
      filePath: txtPath,
      fileType: "text/plain",
      placeholder: "",
    });
    expect(inlined).toContain("Attached file `notes.txt`");
    expect(inlined).toContain("hello from a file");
    expect(
      inlineChannelTextFile({
        hasFile: true,
        filePath: pngPath,
        fileType: "image/png",
        placeholder: "",
      })
    ).toBeNull();
  });

  test("no file → empty / null", () => {
    expect(buildChannelImages({ hasFile: false } as never)).toEqual([]);
    expect(inlineChannelTextFile(undefined)).toBeNull();
  });
});
