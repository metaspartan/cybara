export interface CompletionMessage {
  role?: string;
}

export interface CompletionSnapshot {
  messagesList?: CompletionMessage[];
}

export interface CompletionLoadOptions {
  delaysMs?: number[];
  sleep?: (delayMs: number) => Promise<void>;
}

const defaultDelaysMs = [0, 75, 150, 300, 600];

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

export function hasAssistantAfterLatestUser(messages: CompletionMessage[]): boolean {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return false;
  return messages.slice(latestUserIndex + 1).some((message) => message.role === "assistant");
}

export async function loadPersistedCompletion<T extends CompletionSnapshot>(
  load: () => Promise<T>,
  options: CompletionLoadOptions = {}
): Promise<T | null> {
  const delaysMs = options.delaysMs ?? defaultDelaysMs;
  const sleep = options.sleep ?? delay;

  for (const delayMs of delaysMs) {
    if (delayMs > 0) await sleep(delayMs);
    const snapshot = await load();
    if (
      Array.isArray(snapshot.messagesList) &&
      hasAssistantAfterLatestUser(snapshot.messagesList)
    ) {
      return snapshot;
    }
  }

  return null;
}
