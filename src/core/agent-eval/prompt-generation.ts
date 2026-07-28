export type DatasetPromptFocus =
  | "mixed"
  | "coding"
  | "reasoning"
  | "research"
  | "tool_use"
  | "writing";

export type DatasetPromptDifficulty =
  | "mixed"
  | "foundational"
  | "intermediate"
  | "advanced"
  | "expert";

export interface DatasetPromptAuthorInput {
  authorAgentName: string;
  authorModel: string | null;
  targetAgentName: string;
  targetModel: string | null;
  targetToolProfile: string | null;
  objective: string;
  focus: DatasetPromptFocus;
  difficulty: DatasetPromptDifficulty;
  count: number;
  toolsEnabled: boolean;
  seedPrompts: string[];
}

export interface DatasetPromptAuthorMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type DatasetPromptAuthorExecutor = (
  messages: DatasetPromptAuthorMessage[]
) => Promise<string>;

const focusLabels: Record<DatasetPromptFocus, string> = {
  mixed: "a balanced mix of coding, reasoning, research, tool use, and communication",
  coding: "software engineering, debugging, implementation, and verification",
  reasoning: "multi-step analysis, quantitative reasoning, and decision quality",
  research: "source evaluation, synthesis, uncertainty, and evidence-backed conclusions",
  tool_use: "planning and completing realistic tasks with appropriate tools",
  writing: "clear transformation, explanation, editing, and structured communication",
};

const difficultyLabels: Record<DatasetPromptDifficulty, string> = {
  mixed: "a deliberate range from approachable to expert, weighted toward challenging tasks",
  foundational: "foundational tasks with precise, verifiable outcomes",
  intermediate: "intermediate tasks requiring several connected decisions",
  advanced: "advanced tasks requiring sustained analysis and careful verification",
  expert: "expert tasks with ambiguity, constraints, and demanding verification",
};

const promptFocuses = new Set<DatasetPromptFocus>(Object.keys(focusLabels) as DatasetPromptFocus[]);
const promptDifficulties = new Set<DatasetPromptDifficulty>(
  Object.keys(difficultyLabels) as DatasetPromptDifficulty[]
);

export function datasetPromptAuthorMaxOutputTokens(count: number): number {
  const normalizedCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  return Math.min(8_192, Math.max(4_096, normalizedCount * 192));
}

function normalizedPrompt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const prompt = value.replace(/\r\n/g, "\n").trim();
  return prompt ? prompt.slice(0, 8_000) : null;
}

function promptFromRecord(value: Record<string, unknown>): string | null {
  return (
    normalizedPrompt(value.prompt) ??
    normalizedPrompt(value.instruction) ??
    normalizedPrompt(value.input)
  );
}

function promptsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const prompt = normalizedPrompt(entry);
      if (prompt) return [prompt];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const recordPrompt = promptFromRecord(entry as Record<string, unknown>);
      return recordPrompt ? [recordPrompt] : [];
    });
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.prompts)) return promptsFromValue(record.prompts);
  const prompt = promptFromRecord(record);
  return prompt ? [prompt] : [];
}

function jsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates = [trimmed];
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }
  return [...new Set(candidates)];
}

function linePrompts(content: string): string[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```") || /^(?:prompts?|output):?$/i.test(trimmed)) {
      return [];
    }
    try {
      const parsed = promptsFromValue(JSON.parse(trimmed) as unknown);
      if (parsed.length > 0) return parsed;
    } catch {
      const stripped = trimmed.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
      if (stripped !== trimmed || !trimmed.endsWith(":")) return stripped ? [stripped] : [];
    }
    return [];
  });
}

function uniquePrompts(prompts: string[], limit: number, existing: string[] = []): string[] {
  const seen = new Set(existing.map((prompt) => prompt.trim().toLowerCase()));
  const result: string[] = [];
  for (const prompt of prompts) {
    const key = prompt.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(prompt);
    if (result.length >= limit) break;
  }
  return result;
}

export function parseGeneratedDatasetPrompts(content: string, limit: number): string[] {
  for (const candidate of jsonCandidates(content)) {
    try {
      const prompts = uniquePrompts(promptsFromValue(JSON.parse(candidate) as unknown), limit);
      if (prompts.length > 0) return prompts;
    } catch {
      continue;
    }
  }
  return uniquePrompts(linePrompts(content), limit);
}

export function parseDatasetPromptFocus(value: unknown): DatasetPromptFocus {
  return typeof value === "string" && promptFocuses.has(value as DatasetPromptFocus)
    ? (value as DatasetPromptFocus)
    : "mixed";
}

export function parseDatasetPromptDifficulty(value: unknown): DatasetPromptDifficulty {
  return typeof value === "string" && promptDifficulties.has(value as DatasetPromptDifficulty)
    ? (value as DatasetPromptDifficulty)
    : "mixed";
}

function authorMessages(
  input: DatasetPromptAuthorInput,
  count: number,
  excludedPrompts: string[]
): DatasetPromptAuthorMessage[] {
  const targetDetails = [
    `Prompt author: ${input.authorAgentName} (${input.authorModel || "provider default"})`,
    `Target agent: ${input.targetAgentName}`,
    `Target model: ${input.targetModel || "provider default"}`,
    `Target tool profile: ${input.targetToolProfile || "default"}`,
    `Focus: ${focusLabels[input.focus]}`,
    `Difficulty: ${difficultyLabels[input.difficulty]}`,
    `Tools during generation: ${input.toolsEnabled ? "available" : "disabled"}`,
    `Dataset objective: ${input.objective || "broad, reusable agent capability training"}`,
  ];
  if (input.seedPrompts.length > 0) {
    targetDetails.push(
      `Style examples:\n${input.seedPrompts.map((prompt) => `- ${prompt}`).join("\n")}`
    );
  }
  if (excludedPrompts.length > 0) {
    targetDetails.push(
      `Do not repeat these prompts:\n${excludedPrompts.map((prompt) => `- ${prompt}`).join("\n")}`
    );
  }
  targetDetails.push(
    `Create exactly ${count} new prompts. Every prompt must directly satisfy the dataset objective without substituting another language, domain, or task type. Each prompt must be standalone, specific, diverse, and suitable for scoring or later review. Include realistic constraints and a verifiable outcome. Do not answer the prompts. Return only valid JSON matching {"prompts":["..."]}.`
  );
  return [
    {
      role: "system",
      content:
        "You author high-quality prompts for AI training and evaluation datasets. Follow the requested JSON schema exactly, without markdown or commentary.",
    },
    { role: "user", content: targetDetails.join("\n") },
  ];
}

export async function generateDatasetPromptDraft(
  input: DatasetPromptAuthorInput,
  execute: DatasetPromptAuthorExecutor
): Promise<string[]> {
  const firstContent = await execute(authorMessages(input, input.count, []));
  const firstPrompts = parseGeneratedDatasetPrompts(firstContent, input.count);
  if (firstPrompts.length >= input.count) return firstPrompts;
  const missing = input.count - firstPrompts.length;
  const secondContent = await execute(authorMessages(input, missing, firstPrompts));
  const additional = uniquePrompts(
    parseGeneratedDatasetPrompts(secondContent, input.count),
    missing,
    firstPrompts
  );
  const prompts = [...firstPrompts, ...additional].slice(0, input.count);
  if (prompts.length === 0) {
    throw new Error("The prompt author did not return any usable prompts");
  }
  return prompts;
}
