import { describe, expect, test } from "bun:test";
import { prepareAgentMessagesForProvider } from "../../src/core/llm/provider-image-input";

const VALID_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==";

function pngContainer(width: number, height: number): string {
  const data = Buffer.alloc(45);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[24] = 8;
  data[25] = 2;
  data.write("IEND", 37, "ascii");
  return data.toString("base64");
}

describe("provider image input", () => {
  test("corrects the MIME type from decoded image bytes", async () => {
    const messages = await prepareAgentMessagesForProvider([
      {
        role: "user",
        content: "Inspect this",
        images: [{ data: VALID_JPEG_BASE64, mimeType: "image/png" }],
      },
    ]);

    expect(messages[0]?.images?.[0]?.mimeType).toBe("image/jpeg");
    expect(messages[0]?.images?.[0]?.data).toBe(VALID_JPEG_BASE64);
  });

  test("omits corrupt image bytes before a provider request", async () => {
    const messages = await prepareAgentMessagesForProvider([
      {
        role: "user",
        content: "Inspect this",
        images: [{ data: Buffer.from("not an image").toString("base64"), mimeType: "image/png" }],
      },
    ]);

    expect(messages[0]?.images).toBeUndefined();
    expect(messages[0]?.content).toContain("could not be decoded");
  });

  test("omits images with pathological dimensions before a provider request", async () => {
    const messages = await prepareAgentMessagesForProvider([
      {
        role: "user",
        content: "Inspect this",
        images: [{ data: pngContainer(5000, 120), mimeType: "image/png" }],
      },
    ]);
    expect(messages[0]?.images).toBeUndefined();
    expect(messages[0]?.content).toContain("could not be decoded");
  });

  test("passes remote image URLs through without loading them", async () => {
    const messages = [
      {
        role: "user" as const,
        content: "Inspect this",
        images: [{ url: "https://example.com/image.png", mimeType: "image/png" }],
      },
    ];
    expect(await prepareAgentMessagesForProvider(messages)).toBe(messages);
  });
});
