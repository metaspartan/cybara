import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi, agentsApi } from '@/lib/api';
import type { ChatMessage } from '@/types';

interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  workspaceDir: string | null;
  isLoading: boolean;
}

interface RevertMessageInput {
  index?: number;
  content?: string;
  timestamp?: string;
}

export function useChat(agentId?: string) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    sessionId: null,
    workspaceDir: null,
    isLoading: false,
  });

  const sendMessage = async (content: string, options?: { workspaceDir?: string | null }) => {
    const userMessage: ChatMessage = { role: 'user', content, timestamp: new Date().toISOString() };
    const requestedWorkspaceDir =
      options?.workspaceDir !== undefined ? options.workspaceDir : state.workspaceDir;
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
    }));
    
    try {
      const response = agentId 
        ? await agentsApi.chat(
            agentId,
            content,
            state.sessionId || undefined,
            requestedWorkspaceDir || undefined
          )
        : await chatApi.send(
            content,
            undefined,
            state.sessionId || undefined,
            requestedWorkspaceDir || undefined
          );
        
      if (response.success && response.data) {
        const resolvedWorkspaceDir =
          response.data.workspaceDir !== undefined
            ? response.data.workspaceDir
            : requestedWorkspaceDir;
        setState((prev) => ({
          messages: [...prev.messages, response.data!.message],
          sessionId: response.data!.sessionId,
          workspaceDir: resolvedWorkspaceDir ?? null,
          isLoading: false,
        }));
        return response.data;
      }
      throw new Error(response.error || 'Failed to send message');
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      throw error;
    }
  };

  const clearChat = () => {
    setState({
      messages: [],
      sessionId: null,
      workspaceDir: null,
      isLoading: false,
    });
  };

  const loadSession = useCallback(
    (sessionId: string, messages: ChatMessage[], workspaceDir?: string | null) => {
      setState({
        messages,
        sessionId,
        workspaceDir: workspaceDir ?? null,
        isLoading: false,
      });
    },
    []
  );

  const setWorkspaceDir = useCallback((workspaceDir: string | null) => {
    setState((prev) => ({
      ...prev,
      workspaceDir,
    }));
  }, []);

  const revertToMessage = async (target: RevertMessageInput) => {
    const activeSessionId = state.sessionId;
    if (!activeSessionId) {
      throw new Error("No active session to revert");
    }

    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      const response = await chatApi.revertSession(activeSessionId, {
        messageIndex: target.index,
        messageRole: "user",
        messageContent: target.content,
        messageTimestamp: target.timestamp,
      });
      if (!response.success || !response.data || response.data.success === false) {
        const message =
          (response.data && "error" in response.data ? response.data.error : null) ||
          response.error ||
          "Failed to revert session";
        throw new Error(message || "Failed to revert session");
      }

      setState((prev) => ({
        ...prev,
        messages: response.data?.messagesList || [],
        isLoading: false,
      }));

      return response.data;
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      throw error;
    }
  };

  return {
    messages: state.messages,
    sessionId: state.sessionId,
    workspaceDir: state.workspaceDir,
    isLoading: state.isLoading,
    sendMessage,
    clearChat,
    loadSession,
    setWorkspaceDir,
    revertToMessage,
  };
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await chatApi.getSessions();
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to fetch sessions');
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await chatApi.deleteSession(sessionId);
      if (response.success) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to delete session');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useLoadSession() {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await chatApi.getSession(sessionId, { includeFullToolCalls: true });
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to load session');
    },
  });
}
