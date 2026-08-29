import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadToolResultImages,
  openAIImageToolFollowup,
  supportsOpenAICompatibleImageToolFollowup,
} from "../../src/core/agent-tool-images";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("agent tool images", () => {
  test("inlines image tool output for the next compatible-model turn", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-tool-image-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "pixel.png");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    await Bun.write(path, png);

    const toolCalls = [{ name: "image", result: { image: path, description: "inspect" } }];
    const images = await loadToolResultImages(toolCalls);
    const followup = await openAIImageToolFollowup(toolCalls);

    expect(images).toEqual([{ data: png.toString("base64"), mimeType: "image/png" }]);
    expect(followup).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Inspect the image returned by the image tool." },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
        },
      ],
    });
  });

  test("ignores missing, unsupported, and unrelated tool results", async () => {
    expect(
      await loadToolResultImages([
        { name: "read", result: { image: "/tmp/not-an-image.png" } },
        { name: "image", result: { image: "/tmp/missing.png" } },
        { name: "image", result: { image: "/tmp/unsupported.bmp" } },
        { name: "image", result: null },
      ])
    ).toEqual([]);
  });

  test("limits compatibility followups to MiniMax M3 endpoints", () => {
    expect(supportsOpenAICompatibleImageToolFollowup("MiniMax-M3")).toBe(true);
    expect(supportsOpenAICompatibleImageToolFollowup("minimaxai/minimax-m3")).toBe(true);
    expect(supportsOpenAICompatibleImageToolFollowup("MiniMax-M3-highspeed")).toBe(true);
    expect(supportsOpenAICompatibleImageToolFollowup("glm-5.3")).toBe(false);
    expect(supportsOpenAICompatibleImageToolFollowup("deepseek-chat")).toBe(false);
  });
});
