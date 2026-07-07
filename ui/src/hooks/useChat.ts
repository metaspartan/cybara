import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chatApi, agentsApi, extractApiError } from "@/lib/api";
import type { ChatMessage } from "@/types";

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

const CHAT_SESSION_LIST_LIMIT = 150;

export function useChat(agentId?: string) {
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const [state, setState] = useState<ChatState>({
    messages: [],
    sessionId: null,
    workspaceDir: null,
    isLoading: false,
  });

  const sendMessage = async (
    content: string,
    options?: {
      workspaceDir?: string | null;
      queueMode?: "queue" | "steer";
      sessionId?: string;
      clientPendingId?: string;
    }
  ) => {
    const queueMode = options?.queueMode;
    const queuedSend = !!queueMode;
    if (!queuedSend) {
      activeRequestAbortRef.current?.abort();
    }
    const controller = new AbortController();
    const requestSessionId =
      options?.sessionId ?? state.sessionId ?? (!queuedSend ? crypto.randomUUID() : null);
    if (!queuedSend) {
      activeRequestAbortRef.current = controller;
    }
    const userMessage: ChatMessage = { role: "user", content, timestamp: new Date().toISOString() };
    const requestedWorkspaceDir =
      options?.workspaceDir !== undefined ? options.workspaceDir : state.workspaceDir;
    setState((prev) => ({
      ...prev,
      sessionId: requestSessionId ?? prev.sessionId,
      messages: queuedSend ? prev.messages : [...prev.messages, userMessage],
      isLoading: queuedSend ? prev.isLoading : true,
    }));

    try {
      const response = agentId
        ? await agentsApi.chat(
            agentId,
            content,
            requestSessionId || undefined,
            requestedWorkspaceDir || undefined,
            controller.signal,
            queueMode,
            options?.clientPendingId
          )
        : await chatApi.send(
            content,
            undefined,
            requestSessionId || undefined,
            requestedWorkspaceDir || undefined,
            controller.signal,
            queueMode,
            options?.clientPendingId
          );

      if (response.success && response.data) {
        if (!queuedSend && activeRequestAbortRef.current !== controller) {
          return null;
        }
        const resolvedWorkspaceDir =
          response.data.workspaceDir !== undefined
            ? response.data.workspaceDir
            : requestedWorkspaceDir;
        if (response.data.queued) {
          setState((prev) =>
            prev.sessionId !== requestSessionId
              ? prev
              : {
                  ...prev,
                  messages: queuedSend
                    ? prev.messages
                    : prev.messages.filter((message) => message !== userMessage),
                  sessionId: response.data!.sessionId,
                  workspaceDir: resolvedWorkspaceDir ?? null,
                  isLoading: queuedSend ? prev.isLoading : false,
                }
          );
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
          return response.data;
        }
        if (response.data.interrupted) {
          setState((prev) =>
            prev.sessionId === requestSessionId ? { ...prev, isLoading: false } : prev
          );
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
          return response.data;
        }
        setState((prev) => ({
          // Ignore stale responses if the user switched sessions while the request was in-flight.
          ...(prev.sessionId !== requestSessionId
            ? prev
            : {
                messages: queuedSend
                  ? [...prev.messages, userMessage, response.data!.message]
                  : [...prev.messages, response.data!.message],
                sessionId: response.data!.sessionId,
                workspaceDir: resolvedWorkspaceDir ?? null,
                isLoading: false,
              }),
        }));
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        return response.data;
      }
      throw new Error(response.error || "Failed to send message");
    } catch (error) {
      if (!queuedSend && activeRequestAbortRef.current === controller) {
        setState((prev) =>
          prev.sessionId === requestSessionId ? { ...prev, isLoading: false } : prev
        );
      }
      const isAbortError =
        error instanceof DOMException
          ? error.name === "AbortError"
          : !!error &&
            typeof error === "object" &&
            "name" in error &&
            (error as { name?: string }).name === "AbortError";
      if (isAbortError) {
        return null;
      }
      throw error;
    } finally {
      if (!queuedSend && activeRequestAbortRef.current === controller) {
        activeRequestAbortRef.current = null;
      }
    }
  };

  const clearChat = () => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    setState({
      messages: [],
      sessionId: null,
      workspaceDir: null,
      isLoading: false,
    });
  };

  const stopGenerating = useCallback(() => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

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

  const appendSessionMessage = useCallback(
    (sessionId: string, message: ChatMessage, workspaceDir?: string | null) => {
      setState((prev) => {
        if (prev.sessionId !== sessionId) return prev;
        const messageKey = `${message.role}\u0000${message.timestamp || ""}\u0000${message.content}`;
        const alreadyPresent = prev.messages.some(
          (existing) =>
            `${existing.role}\u0000${existing.timestamp || ""}\u0000${existing.content}` ===
            messageKey
        );
        return {
          ...prev,
          messages: alreadyPresent ? prev.messages : [...prev.messages, message],
          workspaceDir: workspaceDir ?? prev.workspaceDir,
        };
      });
    },
    []
  );

  const appendSessionMessages = useCallback(
    (sessionId: string, nextMessages: ChatMessage[], workspaceDir?: string | null) => {
      setState((prev) => {
        if (prev.sessionId !== sessionId || nextMessages.length === 0) return prev;
        const existingKeys = new Set(
          prev.messages.map(
            (message) => `${message.role}\u0000${message.timestamp || ""}\u0000${message.content}`
          )
        );
        const messagesToAppend = nextMessages.filter((message) => {
          const messageKey = `${message.role}\u0000${message.timestamp || ""}\u0000${message.content}`;
          if (existingKeys.has(messageKey)) return false;
          existingKeys.add(messageKey);
          return true;
        });
        if (messagesToAppend.length === 0) {
          return {
            ...prev,
            workspaceDir: workspaceDir ?? prev.workspaceDir,
          };
        }
        return {
          ...prev,
          messages: [...prev.messages, ...messagesToAppend],
          workspaceDir: workspaceDir ?? prev.workspaceDir,
        };
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
        throw new Error(extractApiError(response, "Failed to revert session"));
      }

      setState((prev) => ({
        ...prev,
        messages: response.data?.messagesList || [],
        isLoading: false,
      }));
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });

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
    appendSessionMessage,
    appendSessionMessages,
    setWorkspaceDir,
    revertToMessage,
    stopGenerating,
  };
}

export function useSessions(options?: { limit?: number }) {
  const limit = options?.limit ?? CHAT_SESSION_LIST_LIMIT;
  return useQuery({
    queryKey: ["sessions", { limit }],
    queryFn: async () => {
      const response = await chatApi.getSessions({ limit });
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to fetch sessions");
    },
    refetchOnWindowFocus: false,
    staleTime: 30_000,
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
      throw new Error(response.error || "Failed to delete session");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useRenameSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, title }: { sessionId: string; title: string }) => {
      const response = await chatApi.updateSessionTitle(sessionId, title);
      if (response.success && response.data?.success) {
        return response.data;
      }
      throw new Error(extractApiError(response, "Failed to rename session"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function usePinSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, pinned }: { sessionId: string; pinned: boolean }) => {
      const response = await chatApi.pinSession(sessionId, pinned);
      if (response.success && response.data?.success) {
        return response.data;
      }
      throw new Error(extractApiError(response, "Failed to pin session"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useUpdateSessionAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, agentId }: { sessionId: string; agentId: string }) => {
      const response = await chatApi.updateSessionAgent(sessionId, agentId);
      if (response.success && response.data?.success) {
        return response.data;
      }
      throw new Error(extractApiError(response, "Failed to update session agent"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
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
      throw new Error(response.error || "Failed to load session");
    },
  });
}
