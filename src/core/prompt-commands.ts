import { listPluginCommands } from "./plugins/runtime";

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
  expand: (args: string) => string;
}

const PLAN_TEMPLATE = (task: string) =>
  [
    "Plan before acting. Do not edit files or run commands yet.",
    "",
    `Task: ${task}`,
    "",
    "Produce a concise plan:",
    "1. Restate the goal and any constraints in one or two sentences.",
    "2. List the concrete steps in order, noting the files/tools each touches.",
    "3. Call out risks, unknowns, and how you'll verify success.",
    "Then ask me to confirm before you start, unless the task is trivial.",
  ].join("\n");

const REVIEW_TEMPLATE = (target: string) =>
  [
    "Do a focused code review.",
    target.trim()
      ? `Target: ${target}`
      : "Target: the current uncommitted changes (use git to inspect the diff).",
    "",
    "Report only real issues, most severe first: correctness bugs, security problems,",
    "missing error handling, and clear performance traps. For each, give the file:line,",
    "a one-line description, and the concrete failure scenario. Skip style nits. If",
    "nothing meaningful is wrong, say so plainly.",
  ].join("\n");

const SECURITY_TEMPLATE = (target: string) =>
  [
    "Run an authorized security assessment of code the user owns or has permission to assess.",
    target.trim() ? `Target: ${target}` : "Target: the current workspace.",
    "",
    "1. Load @security-scan and follow its instructions for this turn.",
    "2. Call security_scan with action=info to verify the active analysis engine without exposing credentials.",
    "3. Call security_scan with action=scan against the target directly. Do not inspect the repository separately before calling it. The tool always uses this active agent, provider, and model and supports cancellation.",
    "4. Use action=validate on plausible findings before presenting them. Do not report unsupported checklist items.",
    "5. Report verified findings most severe first with attack path, evidence, and minimal remediation.",
    "6. Do not apply a patch unless the user explicitly asks for remediation.",
  ].join("\n");

const TEST_TEMPLATE = (args: string) =>
  [
    "Run the project's tests and fix what's broken.",
    args.trim() ? `Scope: ${args}` : "Scope: the most relevant tests for recent changes.",
    "",
    "1. Find and run the appropriate test command for this project.",
    "2. If tests fail, diagnose the root cause and fix it (code or test, whichever is wrong).",
    "3. Re-run until green, then report what failed and what you changed. Do not weaken",
    "   assertions just to pass.",
  ].join("\n");

const SUMMARIZE_TEMPLATE = (args: string) =>
  [
    args.trim() ? `Summarize: ${args}` : "Summarize our conversation and the work done so far.",
    "",
    "Give a tight summary: what was accomplished, key decisions and why, current state,",
    "and any open questions or next steps. Be specific and skip filler.",
  ].join("\n");

const COMMANDS: Record<string, PromptCommand> = {
  learn: {
    name: "learn",
    expand: (args) =>
      LEARN_TEMPLATE(
        args.trim() || "the most useful reusable technique from our recent conversation"
      ),
  },
  plan: {
    name: "plan",
    expand: (args) => PLAN_TEMPLATE(args.trim() || "the request I just described"),
  },
  review: {
    name: "review",
    expand: (args) => REVIEW_TEMPLATE(args),
  },
  security: {
    name: "security",
    expand: (args) => SECURITY_TEMPLATE(args),
  },
  test: {
    name: "test",
    expand: (args) => TEST_TEMPLATE(args),
  },
  summarize: {
    name: "summarize",
    expand: (args) => SUMMARIZE_TEMPLATE(args),
  },
};

export function expandPromptCommand(message: string): string | null {
  const trimmed = message.trimStart();
  const match = trimmed.match(/^\/([a-z][a-z0-9_-]*)\b[ \t]*([\s\S]*)$/i);
  if (!match) return null;
  const commandName = match[1].toLowerCase();
  const command = COMMANDS[commandName];
  if (command) return command.expand(match[2] ?? "");
  const pluginCommand = listPluginCommands().find(
    (entry) => entry.id.toLowerCase() === commandName
  );
  if (!pluginCommand) return null;
  const args = match[2]?.trim() || "";
  return args ? `${pluginCommand.prompt}\n\nUser arguments: ${args}` : pluginCommand.prompt;
}

export function listPromptCommands(): string[] {
  return [...Object.keys(COMMANDS), ...listPluginCommands().map((command) => command.id)];
}
