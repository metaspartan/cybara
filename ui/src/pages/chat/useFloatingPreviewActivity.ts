import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveActivityItem } from "@/lib/chatActivities";
import { isAgentUsingBrowser, isAgentUsingComputer } from "./floatingPreviewActivityModel";

interface FloatingPreviewActivityOptions {
  activeSessionIds: string[];
  liveActivities: LiveActivityItem[];
  sessionId: string | null;
}

interface FloatingPreviewActivityState {
  browserActive: boolean;
  browserAvailable: boolean;
  computerAvailable: boolean;
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
  const [computerSeenSessionId, setComputerSeenSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setBrowserSeenSessionId(null);
      return;
    }
    if (browserActive) setBrowserSeenSessionId(sessionId);
  }, [browserActive, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setComputerSeenSessionId(null);
      return;
    }
    if (computerActive) setComputerSeenSessionId(sessionId);
  }, [computerActive, sessionId]);

  const markComputerAvailable = useCallback((): void => {
    if (sessionId) setComputerSeenSessionId(sessionId);
  }, [sessionId]);

  return {
    browserActive,
    browserAvailable: browserSeenSessionId === sessionId || browserActive,
    computerAvailable: computerSeenSessionId === sessionId || computerActive,
    markComputerAvailable,
  };
}
