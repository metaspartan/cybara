import { useCallback, useEffect, useRef, useState } from "react";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  relaunchDesktopApp,
} from "@/lib/desktopUpdater";
import { isTauriDesktopRuntime } from "@/lib/desktopHost";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "done"
  | "error";

const CHECK_INTERVAL_MS = 60 * 1000;

async function notifyTray(available: boolean, version: string | null): Promise<void> {
  if (!isTauriDesktopRuntime()) return;
  try {
    await invoke("set_update_available", { available, version });
  } catch {
    /* command absent in older builds */
  }
}

export function useDesktopUpdate() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [available, setAvailable] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const installingRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (!isTauriDesktopRuntime() || installingRef.current) return;
    setPhase((current) =>
      current === "idle" || current === "available" || current === "error" ? "checking" : current
    );
    try {
      const update = await checkForDesktopUpdate();
      if (update) {
        setAvailable(update);
        setPhase("available");
        void notifyTray(true, update.version);
      } else {
        setAvailable(null);
        setPhase("idle");
        void notifyTray(false, null);
      }
    } catch {
      setPhase((current) => (current === "checking" ? "idle" : current));
    }
  }, []);

  const startUpdate = useCallback(async () => {
    if (!available || installingRef.current) return;
    installingRef.current = true;
    setProgress(0);
    setPhase("downloading");
    let total = 0;
    let downloaded = 0;
    try {
      await installDesktopUpdate(available, (event: DownloadEvent) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(1, downloaded / total));
        } else if (event.event === "Finished") {
          setProgress(1);
          setPhase("installing");
        }
      });
      setPhase("done");
      await new Promise((resolve) => setTimeout(resolve, 900));
      await relaunchDesktopApp();
    } catch {
      installingRef.current = false;
      setPhase("available");
    }
  }, [available]);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    void runCheck();
    const id = window.setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [runCheck]);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen("cybara://install-update", () => {
      void startUpdate();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* event API unavailable */
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [startUpdate]);

  return { phase, available, progress, startUpdate, check: runCheck };
}
