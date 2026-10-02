import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { apiFetch } from "@/lib/auth";
import {
  bytesToBase64,
  peekChatImageBlob,
  requiresAuthenticatedImageFetch,
} from "@/lib/chatImages";
import { isTauriDesktopRuntime } from "@/lib/desktopHost";
import { IMAGE_MIME_BY_EXTENSION } from "../../../shared/image-formats";

const SAVEABLE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg"];
const MAX_FILE_NAME_STEM = 80;
const FALLBACK_SVG_SIZE = 1024;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS = MAX_IMAGE_BYTES / 4;

export interface ChatImageCopyDeps {
  assertSupported: () => void;
  fetchBlob: (src: string) => Promise<Blob>;
  toPng: (blob: Blob) => Promise<Blob>;
  writePng: (png: Promise<Blob>) => Promise<void>;
}

export interface ChatImageSaveDeps {
  fetchBlob: (src: string) => Promise<Blob>;
  pickPath: (fileName: string, extension: string) => Promise<string | null>;
  writeFile: (path: string, dataBase64: string) => Promise<void>;
  downloadBlob?: (blob: Blob, fileName: string) => void;
}

function extensionForMime(mimeType: string): string | undefined {
  const normalized = mimeType.trim().toLowerCase().split(";")[0] ?? "";
  const canonical = normalized === "image/jpg" ? "image/jpeg" : normalized;
  return SAVEABLE_EXTENSIONS.find(
    (extension) => IMAGE_MIME_BY_EXTENSION[extension] === canonical
  )?.slice(1);
}

const INVALID_FILE_NAME_CHARACTERS = new Set(["<", ">", ":", '"', "|", "?", "*"]);

function stripInvalidFileNameCharacters(value: string): string {
  return Array.from(value)
    .filter(
      (character) => character.charCodeAt(0) >= 0x20 && !INVALID_FILE_NAME_CHARACTERS.has(character)
    )
    .join("");
}

export function chatImageFileName(alt: string, mimeType: string): string {
  const cleaned = stripInvalidFileNameCharacters(alt.trim().split(/[\\/]/).pop() ?? "").trim();
  const dot = cleaned.lastIndexOf(".");
  const altExtension = dot > 0 ? cleaned.slice(dot).toLowerCase() : "";
  const hasKnownExtension = SAVEABLE_EXTENSIONS.includes(altExtension);
  const stem = (hasKnownExtension ? cleaned.slice(0, dot) : cleaned)
    .slice(0, MAX_FILE_NAME_STEM)
    .trim();
  const extension =
    extensionForMime(mimeType) ?? (hasKnownExtension ? altExtension.slice(1) : "png");
  return `${stem || "image"}.${extension}`;
}

function validateImageBlob(blob: Blob): Blob {
  if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES)
    throw new Error("The image is empty or exceeds the 64 MB export limit");
  if (blob.type && !extensionForMime(blob.type))
    throw new Error("The response is not a supported image");
  return blob;
}

function inlineImageBlob(src: string): Blob | undefined {
  if (!src.startsWith("data:")) return undefined;
  const comma = src.indexOf(",");
  if (comma < 0) throw new Error("Inline image data is malformed");
  const header = src.slice(5, comma);
  const mime = header.split(";")[0] ?? "";
  if (!extensionForMime(mime)) throw new Error("Inline content is not a supported image");
  const content = src.slice(comma + 1);
  if (content.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4)
    throw new Error("This image exceeds the 64 MB export limit");
  try {
    if (header.toLowerCase().endsWith(";base64")) {
      const binary = atob(content);
      return validateImageBlob(
        new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: mime })
      );
    }
    return validateImageBlob(new Blob([decodeURIComponent(content)], { type: mime }));
  } catch {
    throw new Error("Inline image data is malformed or too large");
  }
}

async function fetchImageBlob(src: string): Promise<Blob> {
  const inline = inlineImageBlob(src);
  if (inline) return inline;
  const cached = peekChatImageBlob(src);
  if (cached) return validateImageBlob(cached);
  const response = requiresAuthenticatedImageFetch(src) ? await apiFetch(src) : await fetch(src);
  if (!response.ok) throw new Error(`Image request failed with status ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES)
    throw new Error("This image exceeds the 64 MB export limit");
  const blob = await response.blob();
  return validateImageBlob(blob);
}

async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convertToPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const image = await loadImageElement(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || FALLBACK_SVG_SIZE;
  canvas.height = image.naturalHeight || FALLBACK_SVG_SIZE;
  if (canvas.width * canvas.height > MAX_IMAGE_PIXELS)
    throw new Error("This image is too large to copy safely");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error("Could not encode the image as PNG"))),
      "image/png"
    );
  });
}

function assertClipboardImageSupport(): void {
  if (isTauriDesktopRuntime()) return;
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error(
      "This browser cannot copy images. Use Save image as instead, or open Cybara in a secure browser window."
    );
  }
}

async function writePngToClipboard(png: Promise<Blob>): Promise<void> {
  if (isTauriDesktopRuntime()) {
    const blob = await png;
    await invoke("copy_image_to_clipboard", {
      dataBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    });
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError")
    ) {
      throw new Error(
        "The browser blocked clipboard access. Allow clipboard access for this site and try again, or use Save image as."
      );
    }
    throw error;
  }
}

function downloadImageBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function pickImageSavePath(fileName: string, extension: string): Promise<string | null> {
  return save({
    defaultPath: fileName,
    title: "Save image",
    filters: [{ name: "Image", extensions: [extension] }],
  });
}

async function writeImageFile(path: string, dataBase64: string): Promise<void> {
  await invoke("save_image_file", { path, dataBase64 });
}

const DEFAULT_COPY_DEPS: ChatImageCopyDeps = {
  assertSupported: assertClipboardImageSupport,
  fetchBlob: fetchImageBlob,
  toPng: convertToPngBlob,
  writePng: writePngToClipboard,
};

const DEFAULT_SAVE_DEPS: ChatImageSaveDeps = {
  fetchBlob: fetchImageBlob,
  pickPath: pickImageSavePath,
  writeFile: writeImageFile,
};

export async function copyChatImage(
  src: string | Blob,
  deps: ChatImageCopyDeps = DEFAULT_COPY_DEPS
): Promise<void> {
  deps.assertSupported();
  const png = (
    typeof src === "string" ? deps.fetchBlob(src) : Promise.resolve(validateImageBlob(src))
  ).then(deps.toPng);
  void png.catch(() => undefined);
  await deps.writePng(png);
}

export async function saveChatImage(
  src: string | Blob,
  alt: string,
  deps: ChatImageSaveDeps = DEFAULT_SAVE_DEPS
): Promise<boolean> {
  const blob = typeof src === "string" ? await deps.fetchBlob(src) : validateImageBlob(src);
  const mimeType = blob.type.trim();
  if (mimeType && !extensionForMime(mimeType)) throw new Error("This image format cannot be saved");
  const fileName = chatImageFileName(alt, mimeType);
  const download =
    deps.downloadBlob ??
    (deps === DEFAULT_SAVE_DEPS && !isTauriDesktopRuntime() ? downloadImageBlob : undefined);
  if (download) {
    download(blob, fileName);
    return true;
  }
  const path = await deps.pickPath(fileName, fileName.slice(fileName.lastIndexOf(".") + 1));
  if (!path) return false;
  await deps.writeFile(path, bytesToBase64(new Uint8Array(await blob.arrayBuffer())));
  return true;
}
