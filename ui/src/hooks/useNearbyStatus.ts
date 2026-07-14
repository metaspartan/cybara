import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { nearbyApi, type NearbyStatus } from "@/lib/api";

export const nearbyStatusQueryKey = ["nearby-status"] as const;

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
    staleTime: 10_000,
    gcTime: 10 * 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
