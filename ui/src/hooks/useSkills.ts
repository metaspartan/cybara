import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { skillsApi } from '@/lib/api';
import { useSkillStore } from '@/stores';
import type { Skill } from '@/types';

const SKILLS_KEY = 'skills';

export function useSkills() {
  const { setSkills, setLoading } = useSkillStore();
  
  const query = useQuery({
    queryKey: [SKILLS_KEY],
    queryFn: async () => {
      setLoading(true);
      const response = await skillsApi.list();
      if (response.success && response.data) {
        setSkills(response.data);
        return response.data;
      }
      throw new Error(response.error || 'Failed to fetch skills');
    },
  });

  return {
    skills: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateSkill() {
  const queryClient = useQueryClient();
  const { addSkill } = useSkillStore();
  
  return useMutation({
    mutationFn: async (skill: Omit<Skill, 'id' | 'createdAt'>) => {
      const response = await skillsApi.create(skill);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to create skill');
    },
    onSuccess: (data) => {
      addSkill(data);
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
    },
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  const { updateSkill } = useSkillStore();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Skill> }) => {
      const response = await skillsApi.update(id, updates);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to update skill');
    },
    onSuccess: (data) => {
      updateSkill(data.id, data);
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  const { removeSkill } = useSkillStore();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await skillsApi.delete(id);
      if (response.success) return id;
      throw new Error(response.error || 'Failed to delete skill');
    },
    onSuccess: (id) => {
      removeSkill(id);
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
    },
  });
}
