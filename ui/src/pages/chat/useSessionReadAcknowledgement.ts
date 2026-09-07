import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { chatApi } from "@/lib/api";

export function useSessionReadAcknowledgement(
  sessionId: string | null,
  latestAssistantMessageKey: string | null
): void {
  const queryClient = useQueryClient();
  const acknowledgedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const acknowledgementKey = `${sessionId}:${latestAssistantMessageKey ?? ""}`;
    if (acknowledgedRef.current === acknowledgementKey) return;
    acknowledgedRef.current = acknowledgementKey;
    void chatApi.markSessionRead(sessionId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
    });
  }, [latestAssistantMessageKey, queryClient, sessionId]);
}
