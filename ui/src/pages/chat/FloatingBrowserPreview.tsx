import type { ReactElement } from "react";
import { ChatWorkspaceBrowser } from "./ChatWorkspaceBrowser";
import { FloatingPreviewFrame } from "./FloatingPreviewFrame";
import { FLOATING_BROWSER_PREVIEW_STORAGE_KEY } from "./floatingBrowserPreviewModel";

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
  return (
    <FloatingPreviewFrame
      ariaLabel="Open live browser preview"
      bottomInset={bottomInset}
      onActivate={onExpand}
      storageKey={FLOATING_BROWSER_PREVIEW_STORAGE_KEY}
      testId="floating-browser-preview"
      title="Open browser panel"
    >
      <ChatWorkspaceBrowser pageKey={pageKey} sessionId={sessionId} thumbnail visible />
    </FloatingPreviewFrame>
  );
}
