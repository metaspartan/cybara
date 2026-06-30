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
  input?: string[];
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
  gmi: "gmi",
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
      modalities?: { input?: string[] };
    };
    const input = Array.isArray(m.modalities?.input)
      ? m.modalities.input.filter((x): x is string => typeof x === "string")
      : undefined;
    out.push({
      id: m.id || modelId,
      name: m.name,
      contextWindow: typeof m.limit?.context === "number" ? m.limit.context : undefined,
      maxTokens: typeof m.limit?.output === "number" ? m.limit.output : undefined,
      reasoning: m.reasoning === true,
      input,
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
