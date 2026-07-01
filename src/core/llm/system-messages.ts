interface RoledMessage {
  role: string;
  content: unknown;
}

export function coalesceSystemMessages<T extends RoledMessage>(messages: T[]): T[] {
  const systemParts: string[] = [];
  let firstSystem: T | undefined;
  const rest: T[] = [];

  for (const message of messages) {
    if (message.role === "system" && typeof message.content === "string") {
      if (message.content.trim()) systemParts.push(message.content);
      if (!firstSystem) firstSystem = message;
    } else {
      rest.push(message);
    }
  }

  if (systemParts.length <= 1) return messages;

  const merged = { ...(firstSystem as T), role: "system", content: systemParts.join("\n\n") };
  return [merged, ...rest];
}
