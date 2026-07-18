import { describe, expect, test } from "bun:test";
import {
  chatImageSrc,
  chatMarkdownImageSrc,
  chatMarkdownImageSources,
  imageToolResultSrc,
  loadChatImageSource,
  requiresAuthenticatedImageFetch,
  screenshotMediaSrc,
  toolOutputImageSources,
} from "../../ui/src/lib/chatImages";
import { clampLightboxZoom, nextLightboxIndex } from "../../ui/src/pages/chat/imageLightboxModel";

const chatSource =
  (await Bun.file("ui/src/pages/Chat.tsx").text()) +
  (await Bun.file("ui/src/pages/chat/ChatMessageTimeline.tsx").text());
const messageSource = await Bun.file("ui/src/pages/chat/MessageContent.tsx").text();
const lightboxSource = await Bun.file("ui/src/pages/chat/ChatImageLightbox.tsx").text();
const previewSource = await Bun.file("ui/src/pages/chat/ChatImagePreview.tsx").text();

describe("chat image rendering", () => {
  test("maps browser screenshot file links through the secured media route", () => {
    const source = chatMarkdownImageSrc(
      "file:///Users/carsen/.cybara/screenshots/screenshot_1783660799112.jpeg"
    );
    expect(source).toContain("/api/media?path=");
    expect(source).toContain("screenshots%2Fscreenshot_1783660799112.jpeg");
  });

  test("never embeds the api token in media image URLs", () => {
    const fromMarkdown = chatMarkdownImageSrc("file:///Users/carsen/.cybara/screenshots/shot.png");
    const fromScreenshot = screenshotMediaSrc("/Users/carsen/.cybara/screenshots/shot.png");
    const fromAttachment = chatImageSrc({ path: "attachments/photo.png" } as never);
    const fromTool = imageToolResultSrc({
      filePath: "/Users/test/.cybara/screenshots/screen.png",
      contentType: "image/png",
    });

    for (const src of [fromMarkdown, fromScreenshot, fromAttachment, fromTool]) {
      expect(src).not.toBeNull();
      expect(src).not.toContain("token=");
      expect(src).not.toContain("api_key=");
    }
  });

  test("loads protected gateway images through authenticated fetch before rendering", async () => {
    const source = "/api/media?path=screenshots%2Fprotected.png";
    let requested = "";
    let revoked = "";
    const loaded = await loadChatImageSource(
      source,
      (async (input: RequestInfo | URL) => {
        requested = String(input);
        return new Response(new Blob(["png"], { type: "image/png" }), {
          headers: { "Content-Type": "image/png" },
        });
      }) as typeof fetch,
      () => "blob:protected-image",
      (url) => {
        revoked = url;
      }
    );

    expect(requiresAuthenticatedImageFetch(source)).toBe(true);
    expect(requiresAuthenticatedImageFetch("https://example.com/api/media?path=x")).toBe(false);
    expect(requested).toBe(source);
    expect(loaded.src).toBe("blob:protected-image");
    loaded.revoke?.();
    expect(revoked).toBe("blob:protected-image");
  });

  test("rejects failed and non-image media responses", async () => {
    await expect(
      loadChatImageSource(
        "/api/media?path=screenshots%2Fmissing.png",
        (async () => new Response("missing", { status: 404 })) as typeof fetch
      )
    ).rejects.toThrow("Image request failed (404)");
    await expect(
      loadChatImageSource(
        "/api/media?path=screenshots%2Fwrong.png",
        (async () =>
          new Response("not image", {
            headers: { "Content-Type": "application/json" },
          })) as typeof fetch
      )
    ).rejects.toThrow("unsupported content");
  });

  test("keeps web and data images while rejecting arbitrary local files", () => {
    expect(chatMarkdownImageSrc("https://example.com/image.png")).toBe(
      "https://example.com/image.png"
    );
    expect(chatMarkdownImageSrc("data:image/png;base64,aW1n")).toBe("data:image/png;base64,aW1n");
    expect(chatMarkdownImageSrc("file:///Users/carsen/Documents/private.png")).toBeNull();
    expect(chatMarkdownImageSrc("javascript:alert(1)")).toBeNull();
  });

  test("recognizes transformed media URLs and extracts unique screenshot markdown sources", () => {
    const content = [
      "![screenshot](file:///Users/carsen/.cybara/screenshots/first.png)",
      "![screenshot](file:///Users/carsen/.cybara/screenshots/second.png)",
      "![duplicate](file:///Users/carsen/.cybara/screenshots/first.png)",
    ].join("\n\n");
    const sources = chatMarkdownImageSources(content);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain("screenshots%2Ffirst.png");
    expect(sources[1]).toContain("screenshots%2Fsecond.png");
    expect(chatMarkdownImageSrc(sources[0] || "")).toBe(sources[0]);
  });

  test("restores persisted tool screenshots from compact objects and legacy JSON strings", () => {
    const result = {
      filePath: "/Users/test/.cybara/screenshots/screen.png",
      contentType: "image/png",
    };
    expect(imageToolResultSrc(result)).toContain("screenshots%2Fscreen.png");
    expect(imageToolResultSrc(JSON.stringify(result))).toContain("screenshots%2Fscreen.png");
  });

  test("does not repeat markdown screenshots in the tool output gallery", () => {
    const first = "/Users/test/.cybara/screenshots/first.png";
    const second = "/Users/test/.cybara/screenshots/second.png";
    const content = `![screenshot](file://${first})`;
    const sources = toolOutputImageSources(
      [
        { result: { filePath: first, contentType: "image/png" } },
        { result: { filePath: second, contentType: "image/png" } },
        { result: { filePath: second, contentType: "image/png" } },
      ],
      content
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain("screenshots%2Fsecond.png");
  });

  test("chat attachments, markdown images, and tool screenshots open one gallery", () => {
    expect(chatSource).toContain("<ChatImageLightbox");
    expect(previewSource).toContain("data-chat-lightbox-src={displaySource}");
    expect(chatSource).toContain("onOpenImage={openChatImage}");
    expect(previewSource).toContain("data-chat-lightbox-src={displaySource}");
    expect(previewSource).toContain("loadChatImageSource(source)");
    expect(messageSource).toContain("urlTransform={transformChatMarkdownUrl}");
    expect(messageSource).toContain("if (!imageSource) return null");
    expect(chatSource).toContain(
      "toolOutputImageSources(message.tool_calls || [], message.content)"
    );
    expect(messageSource).not.toContain("href={imageSource}");
  });

  test("reserves stable image geometry and memoizes markdown rendering", () => {
    expect(chatSource).toContain("width={320}");
    expect(chatSource).toContain("height={200}");
    expect(chatSource).toContain('className="aspect-[16/10]');
    expect(messageSource).toContain("width={640}");
    expect(messageSource).toContain("height={400}");
    expect(messageSource).toContain("export const MessageContent = memo(MessageContentComponent)");
  });

  test("lightbox supports navigation, zoom, download, and keyboard controls", () => {
    expect(nextLightboxIndex(0, -1, 3)).toBe(2);
    expect(nextLightboxIndex(2, 1, 3)).toBe(0);
    expect(nextLightboxIndex(0, 1, 1)).toBe(0);
    expect(clampLightboxZoom(0)).toBe(0.5);
    expect(clampLightboxZoom(10)).toBe(4);
    expect(lightboxSource).toContain('event.key === "ArrowLeft"');
    expect(lightboxSource).toContain('event.key === "ArrowRight"');
    expect(lightboxSource).toContain('aria-label="Zoom in"');
    expect(lightboxSource).toContain('aria-label="Download image"');
    expect(lightboxSource).toContain("onPointerMove={handlePointerMove}");
  });
});
