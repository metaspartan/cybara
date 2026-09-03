import { Eye, Loader2 } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { ChatWorkspaceComputer } from "./ChatWorkspaceComputer";
import { FloatingPreviewFrame } from "./FloatingPreviewFrame";
import {
  FLOATING_COMPUTER_PREVIEW_STORAGE_KEY,
  persistFloatingPreviewHidden,
  readFloatingPreviewHidden,
} from "./floatingBrowserPreviewModel";

interface FloatingComputerPreviewProps {
  bottomInset: number;
  sessionId: string;
  onPreviewAvailable: () => void;
}

export function FloatingComputerPreview({
  bottomInset,
  sessionId,
  onPreviewAvailable,
}: FloatingComputerPreviewProps): ReactElement {
  const [app, setApp] = useState<string | null>(null);
  const [focusing, setFocusing] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() =>
    readFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)
  );

  const focusApp = useCallback((): void => {
    if (focusing) return;
    setFocusing(true);
    setFocusError(null);
    const query = new URLSearchParams({ sessionId });
    void apiFetch(`/api/computer-use/preview/focus?${query}`, { method: "POST" })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        const result =
          body && typeof body === "object"
            ? (body as { error?: unknown; success?: unknown })
            : null;
        if (response.ok && result?.success === true) return;
        throw new Error(
          typeof result?.error === "string" ? result.error : "Could not focus the app"
        );
      })
      .catch((reason: unknown) => {
        setFocusError(reason instanceof Error ? reason.message : "Could not focus the app");
      })
      .finally(() => setFocusing(false));
  }, [focusing, sessionId]);

  const hide = useCallback((): void => {
    persistFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY, true);
    setHidden(true);
  }, []);

  const show = useCallback((): void => {
    persistFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY, false);
    setHidden(false);
  }, []);

  const label = app ? `Focus ${app}` : "Focus the app used by the agent";

  if (hidden) {
    return (
      <button
        type="button"
        aria-label="Show computer preview"
        className="absolute bottom-0 left-0 z-40 flex items-center gap-1.5 rounded-tr-lg border border-[var(--glass-border)] bg-black/45 px-2 py-1 text-[11px] text-white/80 hover:bg-black/70 hover:text-white"
        data-testid="floating-computer-preview-show"
        onClick={show}
        title="Show computer preview"
      >
        <Eye className="h-3 w-3" strokeWidth={2.2} />
        <span>Computer</span>
      </button>
    );
  }

  return (
    <FloatingPreviewFrame
      ariaLabel={label}
      bottomInset={bottomInset}
      horizontal="left"
      onActivate={focusApp}
      onHide={hide}
      storageKey={FLOATING_COMPUTER_PREVIEW_STORAGE_KEY}
      testId="floating-computer-preview"
      title={label}
    >
      <ChatWorkspaceComputer
        sessionId={sessionId}
        thumbnail
        visible
        onPreviewAppChange={setApp}
        onPreviewAvailable={onPreviewAvailable}
      />
      {focusing ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        </div>
      ) : null}
      {focusError ? (
        <div className="absolute inset-x-2 bottom-2 rounded-lg bg-black/80 px-2 py-1.5 text-center text-[10px] text-red-200">
          {focusError}
        </div>
      ) : null}
    </FloatingPreviewFrame>
  );
}
