import { describe, expect, test } from "bun:test";
import {
  type ChatImageCopyDeps,
  type ChatImageSaveDeps,
  chatImageFileName,
  copyChatImage,
  saveChatImage,
} from "../../ui/src/lib/chatImageExport";
import { bytesToBase64 } from "../../ui/src/lib/chatImages";
import { clampContextMenuPosition } from "../../ui/src/pages/chat/imageContextMenuModel";

const lightboxSource = await Bun.file("ui/src/pages/chat/ChatImageLightbox.tsx").text();

function pngBlob(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
}

function copyDeps(overrides: Partial<ChatImageCopyDeps> = {}): ChatImageCopyDeps {
  return {
    assertSupported: () => undefined,
    fetchBlob: async () => pngBlob(),
    toPng: async (blob) => blob,
    writePng: async (png) => {
      await png;
    },
    ...overrides,
  };
}

function saveDeps(overrides: Partial<ChatImageSaveDeps> = {}): ChatImageSaveDeps {
  return {
    fetchBlob: async () => pngBlob(),
    pickPath: async () => "/tmp/out.png",
    writeFile: async () => undefined,
    ...overrides,
  };
}

describe("chat image file names", () => {
  test("uses the alt text stem with the extension of the real image type", () => {
    expect(chatImageFileName("shot.png", "image/png")).toBe("shot.png");
    expect(chatImageFileName("photo.jpeg", "image/jpeg")).toBe("photo.jpg");
    expect(chatImageFileName("Screenshot of app", "image/webp")).toBe("Screenshot of app.webp");
    expect(chatImageFileName("diagram", "image/svg+xml")).toBe("diagram.svg");
  });

  test("falls back to a safe generic name", () => {
    expect(chatImageFileName("", "image/png")).toBe("image.png");
    expect(chatImageFileName("   ", "")).toBe("image.png");
    expect(chatImageFileName("icon.gif", "")).toBe("icon.gif");
  });

  test("strips path segments and characters that are invalid in file names", () => {
    expect(chatImageFileName("../../etc/hosts", "image/png")).toBe("hosts.png");
    expect(chatImageFileName("C:\\Users\\me\\a<b>c?.png", "image/png")).toBe("abc.png");
    expect(chatImageFileName("x".repeat(300), "image/png").length).toBeLessThanOrEqual(84);
  });
});

describe("copying a chat image", () => {
  test("hands the clipboard a PNG promise built from the fetched image", async () => {
    const written: Blob[] = [];
    const converted: string[] = [];
    await copyChatImage(
      "blob:one",
      copyDeps({
        fetchBlob: async () => new Blob(["jpeg"], { type: "image/jpeg" }),
        toPng: async (blob) => {
          converted.push(blob.type);
          return pngBlob();
        },
        writePng: async (png) => {
          written.push(await png);
        },
      })
    );
    expect(converted).toEqual(["image/jpeg"]);
    expect(written).toHaveLength(1);
    expect(written[0]?.type).toBe("image/png");
  });

  test("fails before fetching when the clipboard cannot hold images", async () => {
    let fetched = false;
    await expect(
      copyChatImage(
        "blob:one",
        copyDeps({
          assertSupported: () => {
            throw new Error("Copying images is not supported in this window");
          },
          fetchBlob: async () => {
            fetched = true;
            return pngBlob();
          },
        })
      )
    ).rejects.toThrow("not supported");
    expect(fetched).toBe(false);
  });

  test("surfaces fetch failures instead of writing an empty clipboard", async () => {
    await expect(
      copyChatImage(
        "blob:gone",
        copyDeps({
          fetchBlob: async () => {
            throw new Error("Image request failed with status 404");
          },
        })
      )
    ).rejects.toThrow("404");
  });
});

describe("saving a chat image", () => {
  test("writes the picked path with the base64 image bytes", async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const picks: Array<{ fileName: string; extension: string }> = [];
    const saved = await saveChatImage(
      "blob:one",
      "shot.png",
      saveDeps({
        pickPath: async (fileName, extension) => {
          picks.push({ fileName, extension });
          return "/Users/me/shot.png";
        },
        writeFile: async (path, data) => {
          writes.push({ path, data });
        },
      })
    );
    expect(saved).toBe(true);
    expect(picks).toEqual([{ fileName: "shot.png", extension: "png" }]);
    expect(writes).toEqual([
      {
        path: "/Users/me/shot.png",
        data: bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
      },
    ]);
  });

  test("writes nothing when the save dialog is cancelled", async () => {
    let wrote = false;
    const saved = await saveChatImage(
      "blob:one",
      "shot.png",
      saveDeps({
        pickPath: async () => null,
        writeFile: async () => {
          wrote = true;
        },
      })
    );
    expect(saved).toBe(false);
    expect(wrote).toBe(false);
  });

  test("refuses image formats the desktop shell cannot save", async () => {
    let picked = false;
    await expect(
      saveChatImage(
        "blob:heic",
        "photo",
        saveDeps({
          fetchBlob: async () => new Blob(["heic"], { type: "image/heic" }),
          pickPath: async () => {
            picked = true;
            return "/tmp/photo.png";
          },
        })
      )
    ).rejects.toThrow("cannot be saved");
    expect(picked).toBe(false);
  });
});

describe("image context menu", () => {
  test("keeps the menu inside the viewport", () => {
    const viewport = { width: 800, height: 600 };
    expect(clampContextMenuPosition({ x: 100, y: 120 }, viewport)).toEqual({ x: 100, y: 120 });
    const nearCorner = clampContextMenuPosition({ x: 790, y: 590 }, viewport);
    expect(nearCorner.x).toBeLessThan(790);
    expect(nearCorner.y).toBeLessThan(590);
    expect(clampContextMenuPosition({ x: -20, y: -20 }, viewport)).toEqual({ x: 8, y: 8 });
  });

  test("lightbox only replaces the native menu in the desktop shell", () => {
    expect(lightboxSource).toContain("isTauriDesktopRuntime()");
    expect(lightboxSource).toContain("if (!desktop) return;");
    expect(lightboxSource).toContain("onContextMenu={handleContextMenu}");
    expect(lightboxSource).toContain("<ChatImageContextMenu");
    expect(lightboxSource).toContain("contextMenuOpenRef.current");
  });
});
