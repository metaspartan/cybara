import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { memoryApi } from '@/lib/api';
import { useMemoryStore } from '@/stores';
import type { Memory } from '@/types';

const MEMORY_KEY = 'memory';

export function useMemory(params?: { agentId?: string; userId?: string; limit?: number }) {
  const { setMemories, setLoading } = useMemoryStore();
  
  const query = useQuery({
    queryKey: [MEMORY_KEY, params],
    queryFn: async () => {
      setLoading(true);
      const response = await memoryApi.list(params);
      if (response.success && response.data) {
        setMemories(response.data);
        return response.data;
      }
      throw new Error(response.error || 'Failed to fetch memories');
    },
  });

  return {
    memories: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useSearchMemory() {
  return useMutation({
    mutationFn: async ({ query, limit }: { query: string; limit?: number }) => {
      const response = await memoryApi.search(query, limit);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to search memories');
    },
  });
}

export function useCreateMemory() {
  const queryClient = useQueryClient();
  const { addMemory } = useMemoryStore();
  
  return useMutation({
    mutationFn: async (memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>) => {
      const response = await memoryApi.create(memory);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to create memory');
    },
    onSuccess: (data) => {
      addMemory(data);
      queryClient.invalidateQueries({ queryKey: [MEMORY_KEY] });
    },
  });
}

export function useUpdateMemory() {
  const queryClient = useQueryClient();
  const { updateMemory } = useMemoryStore();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Memory> }) => {
      const response = await memoryApi.update(id, updates);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to update memory');
    },
    onSuccess: (data) => {
      updateMemory(data.id, data);
      queryClient.invalidateQueries({ queryKey: [MEMORY_KEY] });
    },
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();
  const { removeMemory } = useMemoryStore();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await memoryApi.delete(id);
      if (response.success) return id;
      throw new Error(response.error || 'Failed to delete memory');
    },
    onSuccess: (id) => {
      removeMemory(id);
      queryClient.invalidateQueries({ queryKey: [MEMORY_KEY] });
    },
  });
}
