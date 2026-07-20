import type { ChatFileAttachment } from "@/lib/chatImages";
import {
  chatImageSrc,
  formatBytes,
  imageAttachmentBytes,
  MAX_CHAT_IMAGES,
  mediaSummaryLabel,
} from "@/lib/chatImages";
import { cn } from "@/lib/utils";
import type { ChatImageAttachment } from "@/types";
import { FileText, Paperclip, X } from "lucide-react";
import type { RefObject } from "react";

const attachmentKeys = new WeakMap<object, number>();
let nextAttachmentKey = 0;

function attachmentKey(attachment: object): number {
  const current = attachmentKeys.get(attachment);
  if (current !== undefined) return current;
  nextAttachmentKey += 1;
  attachmentKeys.set(attachment, nextAttachmentKey);
  return nextAttachmentKey;
}

export function ChatComposerAttachments({
  compact = false,
  imageInputRef,
  pendingFiles,
  pendingImages,
  onAddAttachmentFiles,
  onRemovePendingFile,
  onRemovePendingImage,
}: {
  compact?: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  pendingFiles: ChatFileAttachment[];
  pendingImages: ChatImageAttachment[];
  onAddAttachmentFiles: (files: Iterable<File>) => void | Promise<void>;
  onRemovePendingFile: (index: number) => void;
  onRemovePendingImage: (index: number) => void;
}) {
  return (
    <>
      {pendingImages.length > 0 || pendingFiles.length > 0 ? (
        <div className="mb-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <Paperclip className="h-3 w-3 shrink-0" />
            <span>{mediaSummaryLabel(pendingImages, pendingFiles)}</span>
            {pendingImages.length >= MAX_CHAT_IMAGES ? (
              <span className="text-amber-300/80">· max {MAX_CHAT_IMAGES} images</span>
            ) : null}
          </div>
          <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
            {pendingImages.map((image, index) => (
              <div
                key={`pending-image-${attachmentKey(image)}`}
                className={cn(
                  "group relative overflow-hidden rounded-lg border border-[var(--surface-border)]",
                  compact ? "h-10 w-10" : "h-16 w-16"
                )}
                title={`${image.name || "image"}${
                  imageAttachmentBytes(image)
                    ? ` · ${formatBytes(imageAttachmentBytes(image))}`
                    : ""
                }`}
              >
                <img
                  src={chatImageSrc(image)}
                  alt={image.name || "Attachment preview"}
                  className="h-full w-full object-cover"
                />
                {imageAttachmentBytes(image) > 0 && !compact ? (
                  <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 py-px text-[9px] leading-tight text-white/90">
                    {formatBytes(imageAttachmentBytes(image))}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRemovePendingImage(index)}
                  className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            {pendingFiles.map((file, index) => (
              <div
                key={`pending-file-${attachmentKey(file)}`}
                className="flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text-secondary)]"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className={cn("truncate", compact ? "max-w-20" : "max-w-40")}>
                    {file.name}
                  </span>
                  {!compact && formatBytes(file.size) ? (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {formatBytes(file.size)}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => onRemovePendingFile(index)}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--icon-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
                  aria-label="Remove file"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,text/*,.md,.markdown,.json,.jsonc,.csv,.tsv,.xml,.yaml,.yml,.toml,.ini,.log,.html,.css,.scss,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cc,.cs,.php,.sh,.bash,.zsh,.sql,.env,.vue,.svelte"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void onAddAttachmentFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}
