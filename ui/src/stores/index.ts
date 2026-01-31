import { create } from 'zustand';
import type { Provider, Channel, Memory, Task, Skill } from '@/types';

interface ProviderState {
  providers: Provider[];
  isLoading: boolean;
  setProviders: (providers: Provider[]) => void;
  addProvider: (provider: Provider) => void;
  updateProvider: (id: string, updates: Partial<Provider>) => void;
  removeProvider: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useProviderStore = create<ProviderState>((set) => ({
  providers: [],
  isLoading: false,
  setProviders: (providers) => set({ providers }),
  addProvider: (provider) => set((state) => ({ providers: [...state.providers, provider] })),
  updateProvider: (id, updates) => set((state) => ({
    providers: state.providers.map((p) => p.id === id ? { ...p, ...updates } : p),
  })),
  removeProvider: (id) => set((state) => ({
    providers: state.providers.filter((p) => p.id !== id),
  })),
  setLoading: (isLoading) => set({ isLoading }),
}));

interface ChannelState {
  channels: Channel[];
  isLoading: boolean;
  setChannels: (channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  updateChannel: (id: string, updates: Partial<Channel>) => void;
  removeChannel: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  isLoading: false,
  setChannels: (channels) => set({ channels }),
  addChannel: (channel) => set((state) => ({ channels: [...state.channels, channel] })),
  updateChannel: (id, updates) => set((state) => ({
    channels: state.channels.map((c) => c.id === id ? { ...c, ...updates } : c),
  })),
  removeChannel: (id) => set((state) => ({
    channels: state.channels.filter((c) => c.id !== id),
  })),
  setLoading: (isLoading) => set({ isLoading }),
}));

interface MemoryState {
  memories: Memory[];
  searchQuery: string;
  isLoading: boolean;
  setMemories: (memories: Memory[]) => void;
  addMemory: (memory: Memory) => void;
  updateMemory: (id: string, updates: Partial<Memory>) => void;
  removeMemory: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  memories: [],
  searchQuery: '',
  isLoading: false,
  setMemories: (memories) => set({ memories }),
  addMemory: (memory) => set((state) => ({ memories: [memory, ...state.memories] })),
  updateMemory: (id, updates) => set((state) => ({
    memories: state.memories.map((m) => m.id === id ? { ...m, ...updates } : m),
  })),
  removeMemory: (id) => set((state) => ({
    memories: state.memories.filter((m) => m.id !== id),
  })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLoading: (isLoading) => set({ isLoading }),
}));

interface TaskState {
  tasks: Task[];
  isLoading: boolean;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  isLoading: false,
  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTask: (id, updates) => set((state) => ({
    tasks: state.tasks.map((t) => t.id === id ? { ...t, ...updates } : t),
  })),
  removeTask: (id) => set((state) => ({
    tasks: state.tasks.filter((t) => t.id !== id),
  })),
  setLoading: (isLoading) => set({ isLoading }),
}));

interface SkillState {
  skills: Skill[];
  isLoading: boolean;
  setSkills: (skills: Skill[]) => void;
  addSkill: (skill: Skill) => void;
  updateSkill: (id: string, updates: Partial<Skill>) => void;
  removeSkill: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  skills: [],
  isLoading: false,
  setSkills: (skills) => set({ skills }),
  addSkill: (skill) => set((state) => ({ skills: [...state.skills, skill] })),
  updateSkill: (id, updates) => set((state) => ({
    skills: state.skills.map((s) => s.id === id ? { ...s, ...updates } : s),
  })),
  removeSkill: (id) => set((state) => ({
    skills: state.skills.filter((s) => s.id !== id),
  })),
  setLoading: (isLoading) => set({ isLoading }),
}));
