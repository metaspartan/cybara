import { botsApi, extractApiError } from "@/lib/api";
import type { BotRosterItem } from "@/types";
import { useQuery } from "@tanstack/react-query";

export function useBotRoster(): BotRosterItem[] {
  return (
    useQuery<BotRosterItem[]>({
      queryKey: ["bots"],
      queryFn: async () => {
        const response = await botsApi.list();
        if (!response.success || !response.data) {
          throw new Error(extractApiError(response, "Could not load bots"));
        }
        return response.data.bots;
      },
      staleTime: 5_000,
      refetchInterval: 10_000,
    }).data ?? []
  );
}
