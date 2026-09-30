import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { bytesToBase64 } from "@/lib/chatImages";
import { IMAGE_MIME_BY_EXTENSION } from "../../../shared/image-formats";

const SAVEABLE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg"];

const MAX_FILE_NAME_STEM = 80;
const FALLBACK_SVG_SIZE = 1024;

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
}

function extensionForMime(mimeType: string): string | undefined {
  const normalized = mimeType.trim().toLowerCase();
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

async function fetchImageBlob(src: string): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Image request failed with status ${response.status}`);
  return response.blob();
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
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Copying images is not supported in this window");
  }
}

async function writePngToClipboard(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
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
  src: string,
  deps: ChatImageCopyDeps = DEFAULT_COPY_DEPS
): Promise<void> {
  deps.assertSupported();
  await deps.writePng(deps.fetchBlob(src).then(deps.toPng));
}

export async function saveChatImage(
  src: string,
  alt: string,
  deps: ChatImageSaveDeps = DEFAULT_SAVE_DEPS
): Promise<boolean> {
  const blob = await deps.fetchBlob(src);
  const mimeType = blob.type.trim();
  if (mimeType && !extensionForMime(mimeType)) {
    throw new Error("This image format cannot be saved");
  }
  const fileName = chatImageFileName(alt, mimeType);
  const path = await deps.pickPath(fileName, fileName.slice(fileName.lastIndexOf(".") + 1));
  if (!path) return false;
  await deps.writeFile(path, bytesToBase64(new Uint8Array(await blob.arrayBuffer())));
  return true;
}
