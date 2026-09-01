import { useQuery } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { chatApi, type ChatCapabilityOption } from "@/lib/api";
import {
  filterChatCapabilities,
  findActiveCapabilityMention,
  insertChatCapabilityMention,
} from "./chatCapabilityMentions";

interface UseChatCapabilityPickerOptions {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  workspaceDir?: string | null;
  sessionId?: string | null;
  onSend: () => void | Promise<void>;
}

export function useChatCapabilityPicker({
  input,
  setInput,
  inputRef,
  workspaceDir,
  sessionId,
  onSend,
}: UseChatCapabilityPickerOptions) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeMention = useMemo(
    () => (cursor === null ? null : findActiveCapabilityMention(input, cursor)),
    [cursor, input]
  );
  const query = useQuery({
    queryKey: ["chat-capabilities", workspaceDir, sessionId],
    queryFn: async () => {
      const response = await chatApi.capabilities(workspaceDir, sessionId);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load chat capabilities");
      }
      return response.data.capabilities;
    },
    enabled: activeMention !== null,
    staleTime: 300_000,
  });
  const options = useMemo(
    () =>
      activeMention
        ? filterChatCapabilities(query.data || [], activeMention.query, 10, activeMention.trigger)
        : [],
    [activeMention, query.data]
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeMention?.query]);

  const select = useCallback(
    (option: ChatCapabilityOption) => {
      if (!activeMention) return;
      const inserted = insertChatCapabilityMention(input, activeMention, option.token);
      setInput(inserted.value);
      setCursor(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
      });
    },
    [activeMention, input, inputRef, setInput]
  );

  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setInput(event.target.value);
      setCursor(event.target.selectionStart);
    },
    [setInput]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (activeMention) {
        if (event.key === "ArrowDown" && options.length > 0) {
          event.preventDefault();
          setSelectedIndex((index) => (index + 1) % options.length);
          return;
        }
        if (event.key === "ArrowUp" && options.length > 0) {
          event.preventDefault();
          setSelectedIndex((index) => (index - 1 + options.length) % options.length);
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && options.length > 0) {
          event.preventDefault();
          const option = options[Math.min(selectedIndex, options.length - 1)];
          if (option) select(option);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setCursor(null);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void onSend();
      }
    },
    [activeMention, onSend, options, select, selectedIndex]
  );

  return {
    loading: query.isLoading,
    menuOpen: activeMention !== null,
    onChange,
    onCursorChange: setCursor,
    onKeyDown,
    options,
    select,
    selectedIndex,
  };
}
