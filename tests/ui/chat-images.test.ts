import { describe, expect, test } from "bun:test";
import { chatMarkdownImageSrc } from "../../ui/src/lib/chatImages";

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
});
