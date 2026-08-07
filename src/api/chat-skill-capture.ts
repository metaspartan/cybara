import { type AgentMessage, agentManager } from "../core/agent";
import { config } from "../core/config";
import { createLogger } from "../core/logger";
import type { providerManager } from "../core/providers";
import { createLocalSkill, getSkills } from "../core/skills";

const log = createLogger("SkillCapture");

const MUTATION_TOOLS = new Set(["write", "edit", "apply_patch", "exec", "process", "execute_code"]);
const VERIFICATION_TOOLS = new Set(["exec", "process", "execute_code", "read", "browser"]);
const MIN_MUTATIONS = 2;
const MIN_DISTINCT_TOOLS = 3;
const MAX_TOOL_LINES = 40;

interface CapturedToolCall {
  name: string;
  args?: Record<string, unknown>;
  error?: string;
}

const SKILL_CAPTURE_SYSTEM_PROMPT = `You review a completed agent task and decide whether it taught a reusable skill worth saving for future sessions.

Save a skill ONLY when ALL of these hold:
- The task was a non-trivial, multi-step procedure (not a one-off question or a single edit).
- The same procedure is likely to recur on different inputs.
- The steps that worked are generalizable, not specific to this exact file or value.

If it does NOT qualify, reply with exactly: NONE

If it qualifies, reply with a single SKILL.md document and nothing else, in this exact shape:
---
name: <kebab-case-slug>
description: <one sentence: what the skill does and when to use it>
---

# <Title>

<1-3 sentence overview>

## Steps

1. <first generalizable step>
2. <next step>
...

Keep it concise and generalizable. Do not include values, paths, or data specific to this one run.`;

export function shouldCaptureSkillFromToolCalls(toolCalls: CapturedToolCall[]): boolean {
  if (config.get<boolean>("self_improving_skills_enabled") === false) return false;
  let mutations = 0;
  let verifications = 0;
  const distinct = new Set<string>();
  for (const call of toolCalls) {
    const name = call.name;
    if (name === "skill_save" || name === "skill_load") return false;
    if (call.error) continue;
    distinct.add(name);
    if (MUTATION_TOOLS.has(name)) mutations += 1;
    if (VERIFICATION_TOOLS.has(name)) verifications += 1;
  }
  return mutations >= MIN_MUTATIONS && verifications >= 1 && distinct.size >= MIN_DISTINCT_TOOLS;
}

function summarizeToolCalls(toolCalls: CapturedToolCall[]): string {
  return toolCalls
    .slice(0, MAX_TOOL_LINES)
    .map((call) => {
      const argHint = call.args
        ? Object.entries(call.args)
            .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, " ").slice(0, 80)}`)
            .join(" ")
            .slice(0, 160)
        : "";
      return `- ${call.name}${argHint ? `: ${argHint}` : ""}${call.error ? " (failed)" : ""}`;
    })
    .join("\n");
}

interface ParsedSkill {
  name: string;
  description: string;
  content: string;
}

export function parseGeneratedSkill(raw: string): ParsedSkill | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase().startsWith("NONE")) return null;
  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = match[1];
  const body = match[2].trim();
  if (!body) return null;
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim();
  const description = descMatch?.[1]?.trim();
  if (!name || !description) return null;
  if (!/^#\s+/m.test(body) || !/\d+\.\s+/.test(body)) return null;
  return { name, description, content: trimmed };
}

function skillAlreadyExists(name: string, description: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  const normalizedDesc = description.trim().toLowerCase();
  return getSkills().some((skill) => {
    if (skill.name.trim().toLowerCase() === normalizedName) return true;
    return Boolean(skill.description && skill.description.trim().toLowerCase() === normalizedDesc);
  });
}

export async function maybeCaptureSkillFromTurn(params: {
  provider: ReturnType<typeof providerManager.getWithCredentials>;
  agent: NonNullable<ReturnType<typeof agentManager.get>> | undefined;
  sessionId: string;
  userMessage: string;
  toolCalls: CapturedToolCall[];
  workspaceDir?: string | null;
  abortSignal?: AbortSignal;
}): Promise<{ saved: boolean; slug?: string }> {
  const { provider, agent } = params;
  if (!provider || !agent) return { saved: false };
  if (!shouldCaptureSkillFromToolCalls(params.toolCalls)) return { saved: false };

  const captureMessages: AgentMessage[] = [
    { role: "system", content: SKILL_CAPTURE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `User request:\n${params.userMessage.slice(0, 1200)}`,
        `\nTools the agent used, in order:\n${summarizeToolCalls(params.toolCalls)}`,
        "\nDecide now: reply NONE, or a single SKILL.md document.",
      ].join("\n"),
    },
  ];

  let generated: string;
  try {
    const result = await agentManager.callLLM(provider, agent.model, captureMessages, [], {
      agentId: agent.id,
      sessionId: params.sessionId,
      workspaceDir: params.workspaceDir || undefined,
      abortSignal: params.abortSignal,
      suppressStreaming: true,
    });
    generated = result.content;
  } catch (error) {
    log.warn("Skill capture model call failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { saved: false };
  }

  const parsed = parseGeneratedSkill(generated);
  if (!parsed) return { saved: false };
  if (skillAlreadyExists(parsed.name, parsed.description)) return { saved: false };

  const saved = createLocalSkill({
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    category: "learned",
  });
  if (!saved.success) {
    log.warn("Skill capture save failed", { error: saved.error });
    return { saved: false };
  }
  log.info("Captured a new skill from a completed task", { slug: saved.slug });
  return { saved: true, slug: saved.slug };
}
