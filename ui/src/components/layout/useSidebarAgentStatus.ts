import { useEffect, useRef, useState } from "react";
import { chatApi } from "@/lib/api";
import { connectStatusStream } from "@/lib/status-stream";
import { isRunEndingStatus } from "@/pages/chat/sessionRunStatus";
import {
  reconcileActiveSessionSnapshot,
  reconcileAuthoritativeActiveSessions,
  SIDEBAR_ACTIVE_STATUSES,
} from "./activeSessionTracker";

const GLOBAL_STATUS_WINDOW_MS = 60_000;
const STATUS_RECONCILE_INTERVAL_MS = 15_000;

export interface SidebarAgentStatus {
  activeSessionIds: string[];
  status: "idle" | "active";
}

export function useSidebarAgentStatus(): SidebarAgentStatus {
  const [status, setStatus] = useState<"idle" | "active">("idle");
  const [activeSessionIds, setActiveSessionIds] = useState<string[]>([]);
  const activeSessionLastSeenRef = useRef<Map<string, number>>(new Map());
  const globalLastSeenRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const refreshDerivedStatus = () => {
      if (disposed) return;
      const globalActive =
        globalLastSeenRef.current > 0 &&
        Date.now() - globalLastSeenRef.current <= GLOBAL_STATUS_WINDOW_MS;
      const hasActiveSessions = activeSessionLastSeenRef.current.size > 0;
      setStatus(globalActive || hasActiveSessions ? "active" : "idle");
      setActiveSessionIds([...activeSessionLastSeenRef.current.keys()]);
    };

    const hydrateActiveSessions = async () => {
      const requestedAt = Date.now();
      try {
        const response = await chatApi.getSessionStatus();
        if (disposed || !response.success || !response.data) return;
        activeSessionLastSeenRef.current = reconcileAuthoritativeActiveSessions(
          activeSessionLastSeenRef.current,
          Array.isArray(response.data.activeSessionIds) ? response.data.activeSessionIds : [],
          requestedAt
        );
        refreshDerivedStatus();
      } catch {
        return;
      }
    };

    const globalStatusInterval = setInterval(refreshDerivedStatus, 2_000);
    const reconcileInterval = setInterval(() => {
      void hydrateActiveSessions();
    }, STATUS_RECONCILE_INTERVAL_MS);

    const disconnect = connectStatusStream({
      onOpen: () => void hydrateActiveSessions(),
      onEvent: (data) => {
        if (!data || typeof data !== "object" || typeof data.type !== "string") return;
        const now = Date.now();

        if (data.type === "snapshot") {
          const activeSessions = Array.isArray(data.activeSessions) ? data.activeSessions : [];
          activeSessionLastSeenRef.current = reconcileActiveSessionSnapshot(
            activeSessionLastSeenRef.current,
            activeSessions,
            now
          );
          refreshDerivedStatus();
          return;
        }

        if (data.type === "task_completed") {
          const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
          if (sessionId) {
            activeSessionLastSeenRef.current.delete(sessionId);
          } else {
            activeSessionLastSeenRef.current.clear();
            globalLastSeenRef.current = 0;
          }
          refreshDerivedStatus();
          return;
        }

        if (data.type !== "status") return;

        const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
        const runEnded = isRunEndingStatus(data);
        const isActiveStatus = !runEnded && SIDEBAR_ACTIVE_STATUSES.has(data.status);

        if (sessionId) {
          if (isActiveStatus) {
            activeSessionLastSeenRef.current.set(sessionId, now);
          } else if (runEnded) {
            activeSessionLastSeenRef.current.delete(sessionId);
          }
        } else if (isActiveStatus) {
          globalLastSeenRef.current = now;
        } else if (runEnded) {
          globalLastSeenRef.current = 0;
        }
        refreshDerivedStatus();
      },
    });

    void hydrateActiveSessions();

    return () => {
      disposed = true;
      disconnect();
      clearInterval(globalStatusInterval);
      clearInterval(reconcileInterval);
    };
  }, []);

  return { activeSessionIds, status };
}
