import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_DIR = join(process.env.HOME || homedir(), ".cybara");
const CACHE_FILE = join(CACHE_DIR, "models_dev_cache.json");

export interface ModelsDevModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  toolCall?: boolean;
  input?: string[];
  output?: string[];
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  knowledge?: string;
  releaseDate?: string;
  lastUpdated?: string;
  openWeights?: boolean;
}

export const PROVIDER_TO_MODELS_DEV: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "google-gemini-cli": "google",
  xai: "xai",
  deepseek: "deepseek",
  mistral: "mistral",
  groq: "groq",
  cerebras: "cerebras",
  fireworks: "fireworks-ai",
  together: "togetherai",
  deepinfra: "deepinfra",
  novita: "novita",
  openrouter: "openrouter",
  perplexity: "perplexity",
  cohere: "cohere",
  moonshot: "moonshotai",
  "kimi-code": "moonshotai",
  minimax: "minimax",
  "z.ai": "zai",
  "z.ai-coding": "zai",
  qianfan: "baidu",
  nvidia: "nvidia",
  alibaba: "alibaba",
  "alibaba-coding-plan": "alibaba",
  xiaomi: "xiaomi",
  stepfun: "stepfun",
  tencent: "tencent",
  volcengine: "volcengine",
  byteplus: "byteplus",
  huggingface: "huggingface",
  "ollama-cloud": "ollama-cloud",
  bedrock: "amazon-bedrock",
  arcee: "arcee",
  featherless: "featherless-ai",
  gmi: "gmi",
  longcat: "longcat",
  azure: "azure",
  azure_foundry: "azure",
  google_vertex: "google-vertex",
  anthropic_vertex: "google-vertex-anthropic",
  venice: "venice",
  chutes: "chutes",
  github_copilot: "github-copilot",
  opencode_zen: "opencode",
  "vercel-ai-gateway": "vercel",
  llama: "llama",
  nous: "nous",
};

export function extractModelsDevProvider(apiJson: unknown, slug: string): ModelsDevModel[] {
  if (!apiJson || typeof apiJson !== "object") return [];
  const provider = (apiJson as Record<string, unknown>)[slug];
  if (!provider || typeof provider !== "object") return [];
  const models = (provider as { models?: unknown }).models;
  if (!models || typeof models !== "object") return [];

  const out: ModelsDevModel[] = [];
  for (const [modelId, raw] of Object.entries(models as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as {
      id?: string;
      name?: string;
      limit?: { context?: number; output?: number };
      reasoning?: boolean;
      tool_call?: boolean;
      open_weights?: boolean;
      knowledge?: string;
      release_date?: string;
      last_updated?: string;
      modalities?: { input?: string[]; output?: string[] };
      cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
    };
    const strings = (value: unknown): string[] | undefined =>
      Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : undefined;
    const num = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    out.push({
      id: m.id || modelId,
      name: m.name,
      contextWindow: num(m.limit?.context),
      maxTokens: num(m.limit?.output),
      reasoning: m.reasoning === true,
      toolCall: m.tool_call === true,
      openWeights: m.open_weights === true,
      knowledge: typeof m.knowledge === "string" ? m.knowledge : undefined,
      releaseDate: typeof m.release_date === "string" ? m.release_date : undefined,
      lastUpdated: typeof m.last_updated === "string" ? m.last_updated : undefined,
      input: strings(m.modalities?.input),
      output: strings(m.modalities?.output),
      costInput: num(m.cost?.input),
      costOutput: num(m.cost?.output),
      costCacheRead: num(m.cost?.cache_read),
      costCacheWrite: num(m.cost?.cache_write),
    });
  }
  return out;
}

let memoryCache: { fetchedAt: number; data: unknown } | null = null;

async function loadCatalog(): Promise<unknown> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return memoryCache.data;
  }
  if (existsSync(CACHE_FILE)) {
    try {
      const stat = readFileSync(CACHE_FILE, "utf8");
      const parsed = JSON.parse(stat) as { fetchedAt: number; data: unknown };
      if (parsed.fetchedAt && Date.now() - parsed.fetchedAt < CACHE_TTL_MS) {
        memoryCache = parsed;
        return parsed.data;
      }
    } catch {
      /* refetch */
    }
  }
  const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
  const data = await res.json();
  memoryCache = { fetchedAt: Date.now(), data };
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(memoryCache), "utf8");
  } catch {
    /* cache write best-effort */
  }
  return data;
}

export async function discoverModelsDev(providerId: string): Promise<ModelsDevModel[]> {
  const slug = PROVIDER_TO_MODELS_DEV[providerId];
  if (!slug) return [];
  const catalog = await loadCatalog();
  return extractModelsDevProvider(catalog, slug);
}
