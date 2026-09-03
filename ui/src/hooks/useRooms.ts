import { useMutation, useQueryClient } from "@tanstack/react-query";
import { extractApiError, type RoomInput, roomsApi } from "@/lib/api";
import type { RoomSummary } from "@/types";

export function useCreateRoom(options?: { onCreated?: (room: RoomSummary) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RoomInput & { participant_agent_ids: string[] }) => {
      const response = await roomsApi.create(input);
      if (!response.success || !response.data?.room) {
        throw new Error(extractApiError(response, "Could not start group room"));
      }
      return response.data.room;
    },
    onSuccess: (room) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      options?.onCreated?.(room);
    },
  });
}
