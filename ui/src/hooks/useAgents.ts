import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api";
import { useAgentStore } from "@/stores/agentStore";
import type { Agent } from "@/types";

const AGENTS_KEY = "agents";

export function useAgents() {
  const { setAgents, setLoading } = useAgentStore();

  const query = useQuery({
    queryKey: [AGENTS_KEY],
    queryFn: async () => {
      setLoading(true);
      const response = await agentsApi.list();
      if (response.success && response.data) {
        setAgents(response.data);
        return response.data;
      }
      throw new Error(response.error || "Failed to fetch agents");
    },
  });

  return {
    agents: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: [AGENTS_KEY, id],
    queryFn: async () => {
      const response = await agentsApi.get(id);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to fetch agent");
    },
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  const { addAgent } = useAgentStore();

  return useMutation({
    mutationFn: async (agent: Omit<Agent, "id" | "createdAt" | "updatedAt">) => {
      const response = await agentsApi.create(agent);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to create agent");
    },
    onSuccess: (data) => {
      addAgent(data);
      queryClient.invalidateQueries({ queryKey: [AGENTS_KEY] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  const { updateAgent } = useAgentStore();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Agent> }) => {
      const response = await agentsApi.update(id, updates);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to update agent");
    },
    onSuccess: (data) => {
      updateAgent(data.id, data);
      queryClient.invalidateQueries({ queryKey: [AGENTS_KEY] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  const { removeAgent } = useAgentStore();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await agentsApi.delete(id);
      if (response.success) {
        return id;
      }
      throw new Error(response.error || "Failed to delete agent");
    },
    onSuccess: (id) => {
      removeAgent(id);
      queryClient.invalidateQueries({ queryKey: [AGENTS_KEY] });
    },
  });
}
