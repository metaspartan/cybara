import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveActivityItem } from "@/lib/chatActivities";
import {
  computerPreviewDismissDelayMs,
  isAgentUsingBrowser,
  isAgentUsingComputer,
} from "./floatingPreviewActivityModel";

interface FloatingPreviewActivityOptions {
  activeSessionIds: string[];
  liveActivities: LiveActivityItem[];
  sessionId: string | null;
}

interface FloatingPreviewActivityState {
  browserActive: boolean;
  browserAvailable: boolean;
  computerActive: boolean;
  computerAvailable: boolean;
  dismissComputerPreview: () => void;
  markComputerAvailable: () => void;
}

export function useFloatingPreviewActivity({
  activeSessionIds,
  liveActivities,
  sessionId,
}: FloatingPreviewActivityOptions): FloatingPreviewActivityState {
  const sessionActive = !!sessionId && activeSessionIds.includes(sessionId);
  const browserActive = useMemo(
    () => isAgentUsingBrowser(liveActivities, sessionActive),
    [liveActivities, sessionActive]
  );
  const computerActive = useMemo(
    () => isAgentUsingComputer(liveActivities, sessionActive),
    [liveActivities, sessionActive]
  );
  const [browserSeenSessionId, setBrowserSeenSessionId] = useState<string | null>(null);
  const [computerAvailable, setComputerAvailable] = useState(false);
  const [computerPreviewToken, setComputerPreviewToken] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setBrowserSeenSessionId(null);
      return;
    }
    if (browserActive) setBrowserSeenSessionId(sessionId);
  }, [browserActive, sessionId]);

  useEffect(() => {
    if (!sessionId) setComputerAvailable(false);
  }, [sessionId]);

  useEffect(() => {
    if (computerActive) {
      setComputerAvailable(true);
      setComputerPreviewToken((token) => token + 1);
      return;
    }
    const delay = computerPreviewDismissDelayMs({
      active: computerActive,
      available: computerAvailable,
    });
    if (delay === null) return;
    const timer = window.setTimeout(() => setComputerAvailable(false), delay);
    return () => window.clearTimeout(timer);
  }, [computerActive, computerAvailable, computerPreviewToken]);

  const markComputerAvailable = useCallback((): void => {
    if (!sessionId) return;
    setComputerAvailable(true);
    setComputerPreviewToken((token) => token + 1);
  }, [sessionId]);

  const dismissComputerPreview = useCallback((): void => {
    setComputerAvailable(false);
  }, []);

  return {
    browserActive,
    browserAvailable: browserSeenSessionId === sessionId || browserActive,
    computerActive,
    computerAvailable,
    dismissComputerPreview,
    markComputerAvailable,
  };
}
