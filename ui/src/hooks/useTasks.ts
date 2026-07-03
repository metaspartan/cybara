import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "@/lib/api";
import { useTaskStore } from "@/stores";
import type { Task } from "@/types";

const TASKS_KEY = "tasks";

export function useTasks() {
  const { setTasks, setLoading } = useTaskStore();

  const query = useQuery({
    queryKey: [TASKS_KEY],
    queryFn: async () => {
      setLoading(true);
      const response = await tasksApi.list();
      if (response.success && response.data) {
        setTasks(response.data);
        return response.data;
      }
      throw new Error(response.error || "Failed to fetch tasks");
    },
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  const { addTask } = useTaskStore();

  return useMutation({
    mutationFn: async (task: Omit<Task, "id" | "createdAt">) => {
      const response = await tasksApi.create(task);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to create task");
    },
    onSuccess: (data) => {
      addTask(data);
      queryClient.invalidateQueries({ queryKey: [TASKS_KEY] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const { updateTask } = useTaskStore();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Task> }) => {
      const response = await tasksApi.update(id, updates);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to update task");
    },
    onSuccess: (data) => {
      updateTask(data.id, data);
      queryClient.invalidateQueries({ queryKey: [TASKS_KEY] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const { removeTask } = useTaskStore();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await tasksApi.delete(id);
      if (response.success) return id;
      throw new Error(response.error || "Failed to delete task");
    },
    onSuccess: (id) => {
      removeTask(id);
      queryClient.invalidateQueries({ queryKey: [TASKS_KEY] });
    },
  });
}
