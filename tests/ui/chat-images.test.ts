import { describe, expect, test } from "bun:test";
import { chatMarkdownImageSrc, imageToolResultSrc } from "../../ui/src/lib/chatImages";
import { clampLightboxZoom, nextLightboxIndex } from "../../ui/src/pages/chat/imageLightboxModel";

const chatSource = await Bun.file("ui/src/pages/Chat.tsx").text();
const messageSource = await Bun.file("ui/src/pages/chat/MessageContent.tsx").text();
const lightboxSource = await Bun.file("ui/src/pages/chat/ChatImageLightbox.tsx").text();

describe("chat image rendering", () => {
  test("maps browser screenshot file links through the secured media route", () => {
    const source = chatMarkdownImageSrc(
      "file:///Users/carsen/.cybara/screenshots/screenshot_1783660799112.jpeg"
    );
    expect(source).toContain("/api/media?path=");
    expect(source).toContain("screenshots%2Fscreenshot_1783660799112.jpeg");
  });

  test("keeps web and data images while rejecting arbitrary local files", () => {
    expect(chatMarkdownImageSrc("https://example.com/image.png")).toBe(
      "https://example.com/image.png"
    );
    expect(chatMarkdownImageSrc("data:image/png;base64,aW1n")).toBe("data:image/png;base64,aW1n");
    expect(chatMarkdownImageSrc("file:///Users/carsen/Documents/private.png")).toBeNull();
    expect(chatMarkdownImageSrc("javascript:alert(1)")).toBeNull();
  });

  test("restores persisted tool screenshots from compact objects and legacy JSON strings", () => {
    const result = {
      filePath: "/Users/test/.cybara/screenshots/screen.png",
      contentType: "image/png",
    };
    expect(imageToolResultSrc(result)).toContain("screenshots%2Fscreen.png");
    expect(imageToolResultSrc(JSON.stringify(result))).toContain("screenshots%2Fscreen.png");
  });

  test("chat attachments, markdown images, and tool screenshots open one gallery", () => {
    expect(chatSource).toContain("<ChatImageLightbox");
    expect(chatSource).toContain("data-chat-lightbox-src={src}");
    expect(chatSource).toContain("onOpenImage={openChatImage}");
    expect(messageSource).toContain("data-chat-lightbox-src={imageSource}");
    expect(messageSource).not.toContain("href={imageSource}");
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
