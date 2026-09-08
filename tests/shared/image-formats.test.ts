import { describe, expect, test } from "bun:test";
import {
  imageExtensionOf,
  imageMimeForPath,
  isHeicMimeType,
  isImageMimeType,
  isImagePath,
  isProviderImageMimeType,
  isProviderSendableMimeType,
  isRenderableImagePath,
} from "../../shared/image-formats";

describe("shared image formats", () => {
  test("recognizes every renderable image extension regardless of case or query strings", () => {
    for (const path of [
      "/tmp/a.png",
      "C:\\renders\\B.JPG",
      "/x/y.jpeg?cache=1",
      "/x/y.gif#frag",
      "/x/y.webp",
      "/x/y.avif",
      "/x/y.bmp",
      "/x/y.svg",
      "/x/IMG_0001.HEIC",
      "/x/y.heif",
    ]) {
      expect(isImagePath(path)).toBe(true);
    }
    expect(imageExtensionOf("/x/y.jpeg?cache=1")).toBe(".jpeg");
    expect(imageMimeForPath("/x/y.avif")).toBe("image/avif");
    expect(imageMimeForPath("/x/y.svg")).toBe("image/svg+xml");
    expect(imageMimeForPath("/x/IMG.HEIC")).toBe("image/heic");
  });

  test("rejects non-image and undecodable formats", () => {
    for (const path of ["/x/notes.md", "/x/scene.blend", "/x/photo.psd", "/x/noext", ""]) {
      expect(isImagePath(path)).toBe(false);
      expect(imageMimeForPath(path)).toBeUndefined();
    }
  });

  test("recognises TIFF as an image that is decoded before display or provider use", () => {
    expect(imageMimeForPath("/x/photo.tiff")).toBe("image/tiff");
    expect(imageMimeForPath("/x/PHOTO.TIF")).toBe("image/tiff");
    expect(isImagePath("/x/photo.tif")).toBe(true);
    expect(isRenderableImagePath("/x/photo.tiff")).toBe(false);
    expect(isRenderableImagePath("/x/photo.bmp")).toBe(true);
    expect(isRenderableImagePath("/x/photo.heic")).toBe(false);
    expect(isProviderImageMimeType("image/tiff")).toBe(false);
    expect(isProviderSendableMimeType("image/tiff")).toBe(true);
    expect(isProviderSendableMimeType("image/bmp")).toBe(true);
    expect(isProviderSendableMimeType("image/heic")).toBe(true);
    expect(isProviderSendableMimeType("image/avif")).toBe(false);
    expect(isProviderSendableMimeType("image/svg+xml")).toBe(false);
  });

  test("separates what browsers render from what vision providers accept as pixels", () => {
    expect(isImageMimeType("image/avif")).toBe(true);
    expect(isImageMimeType("IMAGE/JPG")).toBe(true);
    expect(isImageMimeType("image/heic-sequence")).toBe(true);
    expect(isImageMimeType("application/pdf")).toBe(false);
    expect(isHeicMimeType("image/heif")).toBe(true);
    expect(isHeicMimeType("image/png")).toBe(false);
    expect(isProviderImageMimeType("image/jpg")).toBe(true);
    expect(isProviderImageMimeType("image/webp")).toBe(true);
    expect(isProviderImageMimeType("image/avif")).toBe(false);
    expect(isProviderImageMimeType("image/bmp")).toBe(false);
    expect(isProviderImageMimeType("image/svg+xml")).toBe(false);
  });
});
