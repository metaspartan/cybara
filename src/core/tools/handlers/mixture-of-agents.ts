import { agentManager } from "../../agent";

export interface MoaProposal {
  agent: string;
  text: string;
}

export interface MoaAgentRef {
  id: string;
  name?: string;
}

export function selectMoaAgents<T extends MoaAgentRef>(
  all: T[],
  requestedIds: string[] | undefined,
  max: number
): T[] {
  if (requestedIds && requestedIds.length > 0) {
    const wanted = new Set(requestedIds);
    return all.filter((a) => wanted.has(a.id));
  }
  return all.slice(0, Math.max(1, max));
}

export function buildMoaSynthesisPrompt(userPrompt: string, proposals: MoaProposal[]): string {
  const sections = proposals
    .map((p, i) => `### Candidate ${i + 1} (from ${p.agent})\n${p.text}`)
    .join("\n\n");
  return [
    "You are an aggregator. You are given an original request and several candidate responses",
    "from different models/agents. Synthesize a single best response that combines their strengths,",
    "corrects any errors, and resolves disagreements. Do not mention that multiple candidates existed.",
    "",
    "## Original request",
    userPrompt,
    "",
    "## Candidate responses",
    sections,
    "",
    "## Your synthesized response:",
  ].join("\n");
}

let moaActive = false;

export async function handleMixtureOfAgents(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) return { error: "mixture_of_agents requires a 'prompt'" };

  if (moaActive) {
    return { error: "mixture_of_agents cannot be nested inside another mixture_of_agents run" };
  }

  const requestedIds = Array.isArray(args.agent_ids)
    ? (args.agent_ids.filter((v) => typeof v === "string") as string[])
    : undefined;
  const maxAgents =
    typeof args.max_agents === "number" && args.max_agents > 0 ? Math.floor(args.max_agents) : 4;

  const all = agentManager.list();
  if (all.length === 0) return { error: "No agents are configured for mixture_of_agents" };

  const proposers = selectMoaAgents(all, requestedIds, maxAgents);
  if (proposers.length === 0) return { error: "No matching proposer agents were found" };

  moaActive = true;
  try {
    const results = await Promise.all(
      proposers.map(async (a) => {
        try {
          const r = await agentManager.message(a.id, prompt);
          return { agent: a.name || a.id, agentId: a.id, text: (r.response || "").trim() };
        } catch (error) {
          return {
            agent: a.name || a.id,
            agentId: a.id,
            text: "",
            error: error instanceof Error ? error.message : "failed",
          };
        }
      })
    );

    const proposals: MoaProposal[] = results
      .filter((r) => r.text)
      .map((r) => ({ agent: r.agent, text: r.text }));

    if (proposals.length === 0) {
      return { error: "All proposer agents failed to produce a response", details: results };
    }

    if (proposals.length === 1) {
      return { final: proposals[0].text, proposals, aggregator: null, note: "single proposal" };
    }

    const requestedAgg =
      typeof args.aggregator_agent_id === "string" ? args.aggregator_agent_id : "";
    const aggregatorId =
      requestedAgg && all.some((a) => a.id === requestedAgg)
        ? requestedAgg
        : proposers[0].id;

    const synthesis = await agentManager.message(
      aggregatorId,
      buildMoaSynthesisPrompt(prompt, proposals)
    );

    return {
      final: (synthesis.response || "").trim(),
      proposals,
      aggregator: aggregatorId,
    };
  } finally {
    moaActive = false;
  }
}
