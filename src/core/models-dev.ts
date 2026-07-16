import { homedir } from "os";
import { join } from "path";
import { mkdir } from "fs/promises";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
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
  meta: "meta",
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
  "kimi-code-oauth": "moonshotai",
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
  "opencode-go": "opencode-go",
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
let catalogLoadInFlight: Promise<unknown> | null = null;

async function readDiskCache(): Promise<{ fetchedAt: number; data: unknown } | null> {
  const file = Bun.file(CACHE_FILE);
  if (!(await file.exists())) return null;
  try {
    const parsed = (await file.json()) as { fetchedAt?: unknown; data?: unknown };
    return typeof parsed.fetchedAt === "number" && "data" in parsed
      ? { fetchedAt: parsed.fetchedAt, data: parsed.data }
      : null;
  } catch {
    return null;
  }
}

async function fetchCatalog(): Promise<unknown> {
  const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
  const data = await response.json();
  memoryCache = { fetchedAt: Date.now(), data };
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await Bun.write(CACHE_FILE, JSON.stringify(memoryCache));
  } catch {
    return data;
  }
  return data;
}

async function loadCatalogFresh(): Promise<unknown> {
  const diskCache = await readDiskCache();
  if (diskCache && Date.now() - diskCache.fetchedAt < CACHE_TTL_MS) {
    memoryCache = diskCache;
    return diskCache.data;
  }
  try {
    return await fetchCatalog();
  } catch (error) {
    if (diskCache) {
      memoryCache = diskCache;
      return diskCache.data;
    }
    throw error;
  }
}

async function loadCatalog(): Promise<unknown> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) return memoryCache.data;
  if (catalogLoadInFlight) return catalogLoadInFlight;
  catalogLoadInFlight = loadCatalogFresh();
  try {
    return await catalogLoadInFlight;
  } finally {
    catalogLoadInFlight = null;
  }
}

export async function discoverModelsDev(providerId: string): Promise<ModelsDevModel[]> {
  const slug = PROVIDER_TO_MODELS_DEV[providerId];
  if (!slug) return [];
  const catalog = await loadCatalog();
  return extractModelsDevProvider(catalog, slug);
}
