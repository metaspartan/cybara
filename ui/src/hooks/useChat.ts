import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { chatApi, agentsApi, extractApiError } from "@/lib/api";
import type { ChatMessage, ChatImageAttachment } from "@/types";
import { enrichReloadedMessages, readCachedSessionMessages } from "@/pages/chat/messageCache";

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
export const SESSION_DETAIL_QUERY_KEY = "session-detail";
const SESSION_DETAIL_STALE_MS = 45_000;
const SESSION_DETAIL_GC_MS = 10 * 60_000;
const SESSION_DETAIL_TIMEOUT_MS = 15_000;

export interface LoadedChatSession {
  id: string;
  agent_id: string;
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  title?: string | null;
  created_at: string;
  updated_at: string;
  workspace_dir?: string | null;
  contextUsage?: unknown;
  tokenUsage?: unknown;
  plan?: unknown;
  messagesList: ChatMessage[];
}

function sessionDetailQueryKey(sessionId: string) {
  return [SESSION_DETAIL_QUERY_KEY, sessionId, "fullToolCalls"] as const;
}

function invalidateSessionDetail(queryClient: QueryClient, sessionId?: string | null) {
  return queryClient.invalidateQueries({
    queryKey: sessionId ? sessionDetailQueryKey(sessionId) : [SESSION_DETAIL_QUERY_KEY],
  });
}

export function useChat(agentId?: string, hookOptions?: { useModelRouter?: boolean }) {
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
      images?: ChatImageAttachment[];
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
    const userMessage: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
      ...(options?.images && options.images.length ? { images: options.images } : {}),
    };
    const requestedWorkspaceDir =
      options?.workspaceDir !== undefined ? options.workspaceDir : state.workspaceDir;
    setState((prev) => ({
      ...prev,
      sessionId: requestSessionId ?? prev.sessionId,
      workspaceDir: requestedWorkspaceDir ?? prev.workspaceDir,
      messages: queuedSend ? prev.messages : [...prev.messages, userMessage],
      isLoading: queuedSend ? prev.isLoading : true,
    }));
    if (!queuedSend && requestSessionId) {
      const queryKey = sessionDetailQueryKey(requestSessionId);
      queryClient.setQueryData<LoadedChatSession>(queryKey, (cached) =>
        cached
          ? {
              ...cached,
              updated_at: userMessage.timestamp || cached.updated_at,
              messagesList: [...cached.messagesList, userMessage],
            }
          : cached
      );
      void invalidateSessionDetail(queryClient, requestSessionId);
    }

    try {
      const response =
        agentId && !hookOptions?.useModelRouter
          ? await agentsApi.chat(
              agentId,
              content,
              requestSessionId || undefined,
              requestedWorkspaceDir || undefined,
              controller.signal,
              queueMode,
              options?.clientPendingId,
              options?.images
            )
          : await chatApi.send(
              content,
              agentId,
              requestSessionId || undefined,
              requestedWorkspaceDir || undefined,
              controller.signal,
              queueMode,
              options?.clientPendingId,
              options?.images,
              hookOptions?.useModelRouter === true
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
          void invalidateSessionDetail(queryClient, response.data.sessionId);
          return response.data;
        }
        if (response.data.interrupted) {
          setState((prev) =>
            prev.sessionId === requestSessionId ? { ...prev, isLoading: false } : prev
          );
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
          void invalidateSessionDetail(queryClient, response.data.sessionId);
          return response.data;
        }
        setState((prev) => ({
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
        void invalidateSessionDetail(queryClient, response.data.sessionId);
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
    (
      sessionId: string,
      messages: ChatMessage[],
      workspaceDir?: string | null,
      preserveReferenceTail = false
    ) => {
      setState((prev) => {
        const reference =
          prev.sessionId === sessionId && prev.messages.length > 0
            ? prev.messages
            : readCachedSessionMessages(sessionId) || [];
        return {
          messages: enrichReloadedMessages(reference, messages, { preserveReferenceTail }),
          sessionId,
          workspaceDir: workspaceDir ?? null,
          isLoading: false,
        };
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
      void invalidateSessionDetail(queryClient, activeSessionId);

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
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void invalidateSessionDetail(queryClient, sessionId);
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void invalidateSessionDetail(queryClient, variables.sessionId);
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void invalidateSessionDetail(queryClient, variables.sessionId);
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void invalidateSessionDetail(queryClient, variables.sessionId);
    },
  });
}

export function useLoadSession() {
  const queryClient = useQueryClient();
  const loadSessionDetail = useCallback(
    async (sessionId: string, querySignal?: AbortSignal): Promise<LoadedChatSession> => {
      const controller = new AbortController();
      const abortFromQuery = () => controller.abort(querySignal?.reason);
      querySignal?.addEventListener("abort", abortFromQuery, { once: true });
      const timeoutId = globalThis.setTimeout(
        () => controller.abort(new DOMException("Session load timed out", "TimeoutError")),
        SESSION_DETAIL_TIMEOUT_MS
      );
      try {
        const response = await chatApi.getSession(sessionId, { signal: controller.signal });
        if (response.success && response.data) {
          return response.data as LoadedChatSession;
        }
        throw new Error(response.error || "Failed to load session");
      } finally {
        globalThis.clearTimeout(timeoutId);
        querySignal?.removeEventListener("abort", abortFromQuery);
      }
    },
    []
  );
  const loadFresh = useCallback(
    async (sessionId: string): Promise<LoadedChatSession> => {
      const result = await loadSessionDetail(sessionId);
      queryClient.setQueryData(sessionDetailQueryKey(sessionId), result);
      return result;
    },
    [loadSessionDetail, queryClient]
  );

  const mutation = useMutation({
    mutationFn: (sessionId: string) =>
      queryClient.fetchQuery({
        queryKey: sessionDetailQueryKey(sessionId),
        staleTime: SESSION_DETAIL_STALE_MS,
        gcTime: SESSION_DETAIL_GC_MS,
        queryFn: ({ signal }) => loadSessionDetail(sessionId, signal),
      }),
  });

  return {
    ...mutation,
    loadFresh,
    getCached: (sessionId: string) =>
      queryClient.getQueryData<LoadedChatSession>(sessionDetailQueryKey(sessionId)),
  };
}
