import { chatApi } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function useSessionReadAcknowledgement(
  sessionId: string | null,
  messageCount: number
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId) return;
    void chatApi.markSessionRead(sessionId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
    });
  }, [messageCount, queryClient, sessionId]);
}
