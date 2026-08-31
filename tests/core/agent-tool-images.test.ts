import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadToolResultImages, openAIImageToolFollowup } from "../../src/core/agent-tool-images";

const temporaryDirectories: string[] = [];
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function createImagePath(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "cybara-tool-image-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "pixel.png");
  await Bun.write(path, tinyPng);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("agent tool images", () => {
  test("inlines image tool output for the next compatible-model turn", async () => {
    const path = await createImagePath();

    const toolCalls = [{ name: "image", result: { image: path, description: "inspect" } }];
    const images = await loadToolResultImages(toolCalls);
    const followup = await openAIImageToolFollowup(toolCalls);

    expect(images).toEqual([{ data: tinyPng.toString("base64"), mimeType: "image/png" }]);
    expect(followup).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Inspect the image returned by the image tool." },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${tinyPng.toString("base64")}` },
        },
      ],
    });
  });

  test("loads browser, computer, and simulator screenshots for native vision followups", async () => {
    const path = await createImagePath();
    const images = await loadToolResultImages([
      { name: "browser", args: { action: "screenshot" }, result: { filePath: path } },
      { name: "computer_use", args: { action: "capture" }, result: { filePath: path } },
      { name: "mobile_simulator", args: { action: "screenshot" }, result: { filePath: path } },
    ]);
    expect(images).toHaveLength(3);
    expect(images.every((image) => image.mimeType === "image/png")).toBe(true);
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
});
