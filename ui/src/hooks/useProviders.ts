import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { providersApi, channelsApi } from "@/lib/api";
import { useProviderStore, useChannelStore } from "@/stores";
import type { Provider, Channel } from "@/types";

const PROVIDERS_KEY = "providers";
const CHANNELS_KEY = "channels";

export function useProviders() {
  const { setProviders, setLoading } = useProviderStore();

  const query = useQuery({
    queryKey: [PROVIDERS_KEY],
    queryFn: async () => {
      setLoading(true);
      const response = await providersApi.list();
      if (response.success && response.data) {
        setProviders(response.data);
        return response.data;
      }
      throw new Error(response.error || "Failed to fetch providers");
    },
  });

  return {
    providers: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  const { addProvider } = useProviderStore();

  return useMutation({
    mutationFn: async (provider: Omit<Provider, "id" | "createdAt">) => {
      const response = await providersApi.create(provider);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to create provider");
    },
    onSuccess: (data) => {
      addProvider(data);
      queryClient.invalidateQueries({ queryKey: [PROVIDERS_KEY] });
    },
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  const { removeProvider } = useProviderStore();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await providersApi.delete(id);
      if (response.success) return id;
      throw new Error(response.error || "Failed to delete provider");
    },
    onSuccess: (id) => {
      removeProvider(id);
      queryClient.invalidateQueries({ queryKey: [PROVIDERS_KEY] });
    },
  });
}

export function useChannels() {
  const { setChannels, setLoading } = useChannelStore();

  const query = useQuery({
    queryKey: [CHANNELS_KEY],
    queryFn: async () => {
      setLoading(true);
      const response = await channelsApi.list();
      if (response.success && response.data) {
        setChannels(response.data);
        return response.data;
      }
      throw new Error(response.error || "Failed to fetch channels");
    },
  });

  return {
    channels: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  const { addChannel } = useChannelStore();

  return useMutation({
    mutationFn: async (channel: Omit<Channel, "id" | "createdAt">) => {
      const response = await channelsApi.create(channel);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to create channel");
    },
    onSuccess: (data) => {
      addChannel(data);
      queryClient.invalidateQueries({ queryKey: [CHANNELS_KEY] });
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  const { removeChannel } = useChannelStore();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await channelsApi.delete(id);
      if (response.success) return id;
      throw new Error(response.error || "Failed to delete channel");
    },
    onSuccess: (id) => {
      removeChannel(id);
      queryClient.invalidateQueries({ queryKey: [CHANNELS_KEY] });
    },
  });
}
