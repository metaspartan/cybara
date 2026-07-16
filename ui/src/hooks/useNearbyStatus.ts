import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { nearbyApi, type NearbyStatus } from "@/lib/api";

export const nearbyStatusQueryKey = ["nearby-status"] as const;

export function canShareNearbySession(
  sessionId: string | null | undefined,
  status: NearbyStatus | null | undefined
): boolean {
  return Boolean(sessionId?.trim() && status?.settings.enabled === true);
}

async function loadNearbyStatus(): Promise<NearbyStatus> {
  const response = await nearbyApi.status();
  if (!response.success || !response.data) {
    throw new Error(response.error || "Could not load Nearby Cybara");
  }
  return response.data;
}

export function useNearbyStatus(enabled = true): UseQueryResult<NearbyStatus, Error> {
  return useQuery<NearbyStatus>({
    queryKey: nearbyStatusQueryKey,
    queryFn: loadNearbyStatus,
    enabled,
    staleTime: 2_000,
    gcTime: 10 * 60_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
