import { type ReactElement, useCallback, useState } from "react";
import { Eye } from "lucide-react";
import { ChatWorkspaceBrowser } from "./ChatWorkspaceBrowser";
import { FloatingPreviewFrame } from "./FloatingPreviewFrame";
import {
  FLOATING_BROWSER_PREVIEW_STORAGE_KEY,
  persistFloatingPreviewHidden,
  readFloatingPreviewHidden,
} from "./floatingBrowserPreviewModel";

interface FloatingBrowserPreviewProps {
  bottomInset: number;
  pageKey?: string;
  sessionId: string;
  onExpand: () => void;
}

export function FloatingBrowserPreview({
  bottomInset,
  pageKey,
  sessionId,
  onExpand,
}: FloatingBrowserPreviewProps): ReactElement {
  const [hidden, setHidden] = useState(() =>
    readFloatingPreviewHidden(FLOATING_BROWSER_PREVIEW_STORAGE_KEY)
  );

  const hide = useCallback((): void => {
    persistFloatingPreviewHidden(FLOATING_BROWSER_PREVIEW_STORAGE_KEY, true);
    setHidden(true);
  }, []);

  const show = useCallback((): void => {
    persistFloatingPreviewHidden(FLOATING_BROWSER_PREVIEW_STORAGE_KEY, false);
    setHidden(false);
  }, []);

  if (hidden) {
    return (
      <button
        type="button"
        aria-label="Show browser preview"
        className="absolute bottom-0 right-0 z-40 flex items-center gap-1.5 rounded-tl-lg border border-[var(--glass-border)] bg-black/45 px-2 py-1 text-[11px] text-white/80 hover:bg-black/70 hover:text-white"
        data-testid="floating-browser-preview-show"
        onClick={show}
        title="Show browser preview"
      >
        <Eye className="h-3 w-3" strokeWidth={2.2} />
        <span>Browser</span>
      </button>
    );
  }

  return (
    <FloatingPreviewFrame
      ariaLabel="Open live browser preview"
      bottomInset={bottomInset}
      onActivate={onExpand}
      onHide={hide}
      storageKey={FLOATING_BROWSER_PREVIEW_STORAGE_KEY}
      testId="floating-browser-preview"
      title="Open browser panel"
    >
      <ChatWorkspaceBrowser pageKey={pageKey} sessionId={sessionId} thumbnail visible />
    </FloatingPreviewFrame>
  );
}
