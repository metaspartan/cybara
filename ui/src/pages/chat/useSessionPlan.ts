import { useEffect, useRef, useState } from "react";
import { chatApi } from "@/lib/api";
import { connectStatusStream } from "@/lib/status-stream";
import type { SessionPlanSnapshot } from "@/types";
import {
  extractLatestPlanFromMessages,
  mergeSessionPlanState,
  type ChatMessage,
  type SessionPlanState,
} from "./chatModel";

interface ScopedSessionPlanState extends SessionPlanState {
  sessionId: string | null;
}

export function useSessionPlan(
  sessionId: string | null,
  typedMessages: ChatMessage[],
  initialPlan?: SessionPlanSnapshot | null
): SessionPlanSnapshot | null {
  const messagesRef = useRef(typedMessages);
  const initialPlanRef = useRef(initialPlan);
  const previousSelectionRef = useRef<{ sessionId: string | null; messages: ChatMessage[] } | null>(
    null
  );
  useEffect(() => {
    messagesRef.current = typedMessages;
    initialPlanRef.current = initialPlan;
  }, [typedMessages, initialPlan]);
  const [state, setState] = useState<ScopedSessionPlanState>({
    sessionId: null,
    plan: null,
    revision: null,
    updatedAt: 0,
    authoritative: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    const previous = previousSelectionRef.current;
    const staleMessages =
      previous && previous.sessionId !== sessionId && previous.messages === messagesRef.current;
    previousSelectionRef.current = { sessionId, messages: messagesRef.current };
    let current: SessionPlanState = {
      plan:
        sessionId && !staleMessages
          ? (initialPlanRef.current ??
            extractLatestPlanFromMessages(messagesRef.current, sessionId))
          : null,
      revision: null,
      updatedAt: 0,
      authoritative: false,
    };
    setState({ ...current, sessionId });
    if (!sessionId) return () => controller.abort();
    let requestId = 0;
    let eventVersion = 0;
    let fetching = false;
    let refreshQueued = false;
    const apply = (plan: SessionPlanSnapshot | null, timestamp = 0): void => {
      if (controller.signal.aborted || (plan && plan.sessionId !== sessionId)) return;
      const next = mergeSessionPlanState(current, plan, timestamp);
      if (next === current) return;
      current = next;
      setState({ ...current, sessionId });
    };
    const refresh = async (): Promise<void> => {
      if (controller.signal.aborted) return;
      if (fetching) {
        refreshQueued = true;
        return;
      }
      fetching = true;
      const id = ++requestId;
      const startedVersion = eventVersion;
      try {
        const result = await chatApi.getSessionPlan(sessionId, controller.signal);
        const response = result.success ? result.data : undefined;
        if (
          response &&
          !controller.signal.aborted &&
          id === requestId &&
          response.sessionId === sessionId &&
          (startedVersion === eventVersion ||
            (current.plan !== null && response.plan?.revision !== undefined))
        ) {
          apply(response.plan, response.plan ? 0 : Date.now());
        }
      } catch {
        refreshQueued = false;
      } finally {
        fetching = false;
        if (refreshQueued && !controller.signal.aborted) {
          refreshQueued = false;
          void refresh();
        }
      }
    };
    const dispose = connectStatusStream({
      onOpen: () => void refresh(),
      onEvent: (event) => {
        if (controller.signal.aborted || !("sessionId" in event) || event.sessionId !== sessionId)
          return;
        if (event.type === "session_plan") {
          eventVersion += 1;
          apply(event.plan, event.timestamp);
        } else if (
          event.type === "session_message" ||
          (event.type === "status" && (event.status === "idle" || event.status === "error"))
        )
          void refresh();
      },
    });
    void refresh();
    return () => {
      controller.abort();
      dispose();
    };
  }, [sessionId]);

  return state.sessionId === sessionId ? state.plan : null;
}
