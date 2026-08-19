import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { chatApi } from "@/lib/api";
import type { SessionGoal } from "@/types";

export const sessionGoalQueryKey = (sessionId: string | undefined): readonly [string, string] => [
  "session-goal",
  sessionId ?? "",
];

export interface SessionGoalController {
  goal: SessionGoal | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setGoal: (objective: string) => Promise<void>;
  updateStatus: (action: "pause" | "resume" | "complete" | "clear", note?: string) => Promise<void>;
}

export function useSessionGoal(
  sessionId: string | undefined,
  options?: { enabled?: boolean }
): SessionGoalController {
  const queryClient = useQueryClient();
  const enabled = options?.enabled !== false && !!sessionId;

  const query = useQuery({
    queryKey: sessionGoalQueryKey(sessionId),
    enabled,
    queryFn: async () => {
      const response = await chatApi.getSessionGoal(sessionId as string);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load session goal");
      }
      return response.data.goal ?? null;
    },
    staleTime: 3_000,
    refetchInterval: (query) => (query.state.data?.status === "active" ? 5_000 : false),
  });

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionGoalQueryKey(sessionId) });
  }, [queryClient, sessionId]);

  const setGoal = useMutation({
    mutationFn: async (objective: string) => {
      const response = await chatApi.setSessionGoal(sessionId as string, objective);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to set session goal");
      }
      return response.data;
    },
    onSuccess: () => void invalidate(),
  });

  const updateStatus = useMutation({
    mutationFn: async (payload: {
      action: "pause" | "resume" | "complete" | "clear";
      note?: string;
    }) => {
      const response = await chatApi.updateSessionGoalStatus(
        sessionId as string,
        payload.action,
        payload.note
      );
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to update session goal");
      }
      return response.data;
    },
    onSuccess: () => void invalidate(),
  });

  return useMemo(
    () => ({
      goal: query.data ?? null,
      loading: query.isLoading,
      refresh: async () => {
        await query.refetch();
      },
      setGoal: async (objective: string) => {
        await setGoal.mutateAsync(objective);
      },
      updateStatus: async (action: "pause" | "resume" | "complete" | "clear", note?: string) => {
        await updateStatus.mutateAsync({ action, note });
      },
    }),
    [query, setGoal, updateStatus]
  );
}
