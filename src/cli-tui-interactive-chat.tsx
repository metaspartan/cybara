import React from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import type { TUIFetchAPI } from "./cli-tui-chat";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface InteractiveChatProps {
  fetchAPI: TUIFetchAPI;
  sessionId: string;
  title?: string;
  modelLine?: string;
  onExit: () => void;
}

function messagesFromResponse(value: unknown): ChatMessage[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)
      ? (value as { messages: unknown[] }).messages
      : [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: string }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant" || role === "system") && typeof content === "string") {
      out.push({ role, content });
    }
  }
  return out;
}

interface Block {
  kind: "text" | "code";
  lang?: string;
  lines: string[];
}

function toBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let inCode = false;
  let current: Block | null = null;
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      if (inCode && current) {
        blocks.push(current);
        current = null;
        inCode = false;
      } else {
        current = { kind: "code", lang: fence[1] || "", lines: [] };
        inCode = true;
      }
      continue;
    }
    if (inCode && current) {
      current.lines.push(line);
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === "text") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "text", lines: [line] });
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function ProseLine({ line }: { line: string }): React.ReactElement {
  const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
  if (bullet) {
    return (
      <Text>
        {bullet[1]}
        <Text color="cyan">• </Text>
        {bullet[2]}
      </Text>
    );
  }
  if (/^\s*>\s?/.test(line)) {
    return <Text color="gray">{line.replace(/^\s*>\s?/, "▏ ")}</Text>;
  }
  if (/^#{1,6}\s/.test(line)) {
    return (
      <Text bold color="white">
        {line.replace(/^#{1,6}\s/, "")}
      </Text>
    );
  }
  return <Text>{line || " "}</Text>;
}

function MessageBlocks({ content }: { content: string }): React.ReactElement {
  const blocks = toBlocks(content);
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return (
            <Box
              key={index}
              flexDirection="column"
              borderStyle="round"
              borderColor="gray"
              paddingX={1}
              marginY={0}
            >
              {block.lang ? <Text color="magenta">{block.lang}</Text> : null}
              {block.lines.map((codeLine, codeIndex) => (
                <Text key={codeIndex} color="green">
                  {codeLine || " "}
                </Text>
              ))}
            </Box>
          );
        }
        return (
          <Box key={index} flexDirection="column">
            {block.lines.map((line, lineIndex) => (
              <ProseLine key={lineIndex} line={line} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

const ROLE_META: Record<ChatMessage["role"], { label: string; color: string }> = {
  user: { label: "You", color: "cyan" },
  assistant: { label: "Cybara", color: "green" },
  system: { label: "System", color: "gray" },
};

function MessageView({ message }: { message: ChatMessage }): React.ReactElement {
  const meta = ROLE_META[message.role];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={meta.color}>
        {meta.label}
      </Text>
      <Box paddingLeft={1}>
        <MessageBlocks content={message.content} />
      </Box>
    </Box>
  );
}

export function InteractiveChatTUI({
  fetchAPI,
  sessionId,
  title,
  modelLine,
  onExit,
}: InteractiveChatProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const loadMessages = React.useCallback(async () => {
    try {
      const response = await fetchAPI<unknown>(`/api/chat/sessions/${sessionId}/messages`);
      setMessages(messagesFromResponse(response));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, sessionId]);

  React.useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      if (trimmed === "/clear") {
        setMessages([]);
        setNotice("Cleared view (session history is unchanged).");
        return;
      }
      if (trimmed === "/help") {
        setNotice("Enter to send · /clear clears view · /reload refetch · Esc or Ctrl+C exits");
        return;
      }
      if (trimmed === "/reload") {
        setLoading(true);
        await loadMessages();
        return;
      }
      setNotice(null);
      setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
      setSending(true);
      try {
        await fetchAPI("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId, stream: false }),
        });
        await loadMessages();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSending(false);
      }
    },
    [fetchAPI, loadMessages, sending, sessionId]
  );

  useInput((value, key) => {
    if (key.ctrl && value === "c") {
      exit();
      return;
    }
    if (key.escape) {
      onExit();
      return;
    }
    if (key.return) {
      const pending = input;
      setInput("");
      void send(pending);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((previous) => previous.slice(0, -1));
      return;
    }
    if (value && !key.ctrl && !key.meta) {
      setInput((previous) => previous + value);
    }
  });

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          💬 {title || "Chat"}
        </Text>
        <Text color="gray">{modelLine || sessionId.slice(0, 8)}</Text>
      </Box>

      {loading ? (
        <Box paddingX={1} paddingY={1}>
          <Text color="yellow">
            <Spinner type="dots" /> Loading conversation…
          </Text>
        </Box>
      ) : (
        <Static items={messages}>
          {(message, index) => (
            <Box key={index} paddingX={1} paddingTop={index === 0 ? 1 : 0}>
              <MessageView message={message} />
            </Box>
          )}
        </Static>
      )}

      {sending ? (
        <Box paddingX={1}>
          <Text color="green">
            <Spinner type="dots" /> Cybara is thinking…
          </Text>
        </Box>
      ) : null}

      {error ? (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      ) : null}
      {notice ? (
        <Box paddingX={1}>
          <Text color="gray">{notice}</Text>
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor={sending ? "gray" : "green"} paddingX={1}>
        <Text color={sending ? "gray" : "green"}>{"› "}</Text>
        <Text>
          {input}
          <Text color="cyan">▏</Text>
        </Text>
      </Box>
      <Box paddingX={1}>
        <Text color="gray">Enter send · /help commands · Esc back · Ctrl+C quit</Text>
      </Box>
    </Box>
  );
}
