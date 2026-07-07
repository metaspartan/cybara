/**
 * Server-side slash-command expansion. A command like `/learn <args>` is not a
 * special tool — following Hermes, it is expanded into a standards-guided prompt
 * and handed to the agent as a normal turn. Because expansion happens in the
 * shared chat path, every client (web, mobile, macOS, channels) gets the same
 * commands with no per-client wiring.
 */

const LEARN_TEMPLATE = (subject: string) =>
  [
    "You are being asked to LEARN a new reusable skill and save it for future sessions.",
    "",
    `Subject: ${subject}`,
    "",
    "Do this now, as a normal turn:",
    "1. Source the material. If the subject is a URL, fetch it with the web_fetch tool.",
    "   If it references local files or a directory, read them. If it describes a",
    "   procedure from our conversation or pasted notes, use that directly.",
    "2. Extract the reusable technique or procedure — the durable how-to, not",
    "   one-off specifics.",
    "3. Author a standardized SKILL.md body with these sections:",
    "   ## When to Use — the trigger conditions.",
    "   ## Procedure — numbered, concrete steps.",
    "   ## Pitfalls — known failure modes and fixes.",
    "   ## Verification — how to confirm it worked.",
    "4. Save it by calling the skill_save tool with a short kebab-case `name`, a",
    "   concise `description` (<= 80 chars), and the SKILL.md body as `content`.",
    "5. Reply with the skill name, what it captures, and when it will trigger.",
    "",
    "Keep the skill focused and general enough to reuse. If the subject is too",
    "vague to make a useful skill, ask one clarifying question instead of guessing.",
  ].join("\n");

interface PromptCommand {
  name: string;
  /** Build the expanded prompt from the text after the command word. */
  expand: (args: string) => string;
}

const COMMANDS: Record<string, PromptCommand> = {
  learn: {
    name: "learn",
    expand: (args) =>
      LEARN_TEMPLATE(
        args.trim() || "the most useful reusable technique from our recent conversation"
      ),
  },
};

/**
 * If `message` begins with a supported slash command (e.g. `/learn ...`),
 * return the expanded prompt. Otherwise return null and the message is used
 * verbatim. Only matches a leading command token so normal messages that merely
 * contain a slash are untouched.
 */
export function expandPromptCommand(message: string): string | null {
  const trimmed = message.trimStart();
  const match = trimmed.match(/^\/([a-z][a-z0-9_-]*)\b[ \t]*([\s\S]*)$/i);
  if (!match) return null;
  const command = COMMANDS[match[1].toLowerCase()];
  if (!command) return null;
  return command.expand(match[2] ?? "");
}

export function listPromptCommands(): string[] {
  return Object.keys(COMMANDS);
}
