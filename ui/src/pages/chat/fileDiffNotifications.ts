import type { FileChangeSummary } from "./chatModel";

const FILE_DIFF_SEEN_PREFIX = "cybara:chat:file-diffs-seen:";

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createFileDiffSignature(
  sessionId: string | null,
  summary: FileChangeSummary | null
): string | null {
  if (!sessionId || !summary || summary.files.length === 0) return null;
  const files = [...summary.files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) =>
      [file.path, file.type, file.added, file.removed, hashString(file.diff || "")].join(":")
    );
  return `v1:${hashString(
    [sessionId, summary.totalAdded, summary.totalRemoved, ...files].join("\u0000")
  )}`;
}

export function readSeenFileDiffSignature(sessionId: string | null): string | null {
  if (!sessionId || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${FILE_DIFF_SEEN_PREFIX}${encodeURIComponent(sessionId)}`);
  } catch {
    return null;
  }
}

export function persistSeenFileDiffSignature(sessionId: string, signature: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${FILE_DIFF_SEEN_PREFIX}${encodeURIComponent(sessionId)}`,
      signature
    );
  } catch {
    return;
  }
}
