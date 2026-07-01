import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { pathToFileURL } from "url";

export type EmbeddingProviderPreference =
    | "auto"
    | "openai"
    | "voyage"
    | "gemini"
    | "ollama"
    | "transformers_js";

export type EmbeddingProviderId =
    | "openai"
    | "voyage"
    | "gemini"
    | "ollama"
    | "transformers_js"
    | "none";

export interface EmbeddingSelection {
    provider?: EmbeddingProviderPreference;
    model?: string;
}

export interface EmbeddingProvider {
    id: EmbeddingProviderId;
    model: string;
    dimensions: number;
    embedQuery: (text: string) => Promise<number[]>;
    embedBatch: (texts: string[]) => Promise<number[][]>;
}

export interface EmbeddingProviderResult {
    provider: EmbeddingProvider;
    source: EmbeddingProviderId;
    fallbackReason?: string;
}

export interface EmbeddingProviderCatalogEntry {
    id: EmbeddingProviderPreference;
    label: string;
    local: boolean;
    available: boolean;
    reason?: string;
    defaultModel: string;
    models: string[];
}

export interface EmbeddingProviderCatalog {
    selected: { provider: EmbeddingProviderPreference; model: string };
    providers: EmbeddingProviderCatalogEntry[];
}

export interface EmbeddingRuntimeStopResult {
    success: boolean;
    provider: EmbeddingProviderId | EmbeddingProviderPreference;
    model: string;
    message: string;
}

export interface EmbeddingRuntimeLoadResult {
    success: boolean;
    provider: EmbeddingProviderId | EmbeddingProviderPreference;
    model: string;
    message: string;
}

type LocalRuntimeState = "idle" | "loading" | "ready" | "error";

export interface TransformersRuntimeModelStatus {
    model: string;
    state: LocalRuntimeState;
    loadedAt: string | null;
    lastUsedAt: string | null;
    lastError: string | null;
}

export interface TransformersRuntimeStatus {
    selectedModel: string;
    selectedState: LocalRuntimeState;
    loadedModels: TransformersRuntimeModelStatus[];
}

const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 1000;

const OPENAI_EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings";
const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";
const OPENAI_MODELS: Record<string, number> = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
};

const VOYAGE_EMBEDDING_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_DEFAULT_MODEL = "voyage-3";
const VOYAGE_MODELS: Record<string, number> = {
    "voyage-3": 1024,
    "voyage-3-large": 1024,
    "voyage-3-lite": 512,
    "voyage-3.5": 1024,
    "voyage-3.5-lite": 1024,
    "voyage-code-3": 1024,
};

const GEMINI_EMBEDDING_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_DEFAULT_MODEL = "text-embedding-004";
const GEMINI_MODELS: Record<string, number> = {
    "text-embedding-004": 768,
};

const OLLAMA_EMBEDDING_ENDPOINT = "http://localhost:11434/api/embeddings";
const OLLAMA_TAGS_ENDPOINT = "http://localhost:11434/api/tags";
const OLLAMA_GENERATE_ENDPOINT = "http://localhost:11434/api/generate";
const OLLAMA_DEFAULT_MODEL = "nomic-embed-text";
const OLLAMA_RECOMMENDED_MODELS = [
    "nomic-embed-text",
    "mxbai-embed-large",
    "snowflake-arctic-embed2",
];

const TRANSFORMERS_DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const TRANSFORMERS_RECOMMENDED_MODELS = [
    "Xenova/all-MiniLM-L6-v2",
    "Xenova/e5-small-v2",
    "Xenova/gte-small",
    "Xenova/multilingual-e5-small",
    "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    "Xenova/bge-small-en-v1.5",
    "Xenova/paraphrase-MiniLM-L3-v2",
];

const TRANSFORMERS_CACHE_DIR = join(process.env.HOME || process.env.USERPROFILE || homedir(), ".cybara", "memory", "transformers");

const transformersExtractorCache = new Map<string, Promise<unknown>>();
const transformersRuntimeState = new Map<
    string,
    { state: LocalRuntimeState; loadedAt?: number; lastUsedAt?: number; lastError?: string | null }
>();
let transformersAvailabilityError: string | null = null;

function normalizeProvider(provider: unknown): EmbeddingProviderPreference {
    if (typeof provider !== "string") return "auto";
    const normalized = provider.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (
        normalized === "auto" ||
        normalized === "openai" ||
        normalized === "voyage" ||
        normalized === "gemini" ||
        normalized === "ollama" ||
        normalized === "transformers_js"
    ) {
        return normalized as EmbeddingProviderPreference;
    }
    if (normalized === "transformers") return "transformers_js";
    return "auto";
}

function normalizeModel(model: unknown): string {
    if (typeof model !== "string") return "";
    return model.trim().slice(0, 180);
}

function normalizeSelection(selection?: EmbeddingSelection): {
    provider: EmbeddingProviderPreference;
    model: string;
} {
    return {
        provider: normalizeProvider(selection?.provider),
        model: normalizeModel(selection?.model),
    };
}

function getCacheKey(provider: string, model: string, text: string): string {
    return `${provider}:${model}:${text.trim().toLowerCase().slice(0, 500)}`;
}

function getFromCache(key: string): number[] | null {
    const cached = embeddingCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.embedding;
    }
    return null;
}

function setCache(key: string, embedding: number[]): void {
    embeddingCache.set(key, { embedding, timestamp: Date.now() });
    if (embeddingCache.size > CACHE_LIMIT) {
        const entries = Array.from(embeddingCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, Math.floor(CACHE_LIMIT / 2));
        entries.forEach(([k]) => embeddingCache.delete(k));
    }
}

function clearProviderCache(provider: string, model?: string): void {
    const prefix = model ? `${provider}:${model}:` : `${provider}:`;
    for (const key of embeddingCache.keys()) {
        if (key.startsWith(prefix)) {
            embeddingCache.delete(key);
        }
    }
}

function toIsoTime(value?: number): string | null {
    if (!value || !Number.isFinite(value)) return null;
    try {
        return new Date(value).toISOString();
    } catch {
        return null;
    }
}

function getRuntimeEntry(model: string): {
    state: LocalRuntimeState;
    loadedAt?: number;
    lastUsedAt?: number;
    lastError?: string | null;
} {
    return (
        transformersRuntimeState.get(model) || {
            state: "idle",
        }
    );
}

function updateRuntimeEntry(
    model: string,
    updates: Partial<{
        state: LocalRuntimeState;
        loadedAt: number;
        lastUsedAt: number;
        lastError: string | null;
    }>
): void {
    const previous = getRuntimeEntry(model);
    const next: {
        state: LocalRuntimeState;
        loadedAt?: number;
        lastUsedAt?: number;
        lastError?: string | null;
    } = {
        ...previous,
        ...updates,
    };
    transformersRuntimeState.set(model, next);
}

function touchTransformersModel(model: string): void {
    updateRuntimeEntry(model, { lastUsedAt: Date.now() });
}

function sanitizeText(input: string, maxLength = 8000): string {
    return input.trim().slice(0, maxLength);
}

async function listOllamaModels(): Promise<string[]> {
    try {
        const response = await fetch(OLLAMA_TAGS_ENDPOINT, {
            method: "GET",
            signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as {
            models?: Array<{ name?: string }>;
        };
        const names = (data.models || [])
            .map((model) => model.name?.trim() || "")
            .filter(Boolean);
        return [...new Set(names)];
    } catch {
        return [];
    }
}

async function isOllamaAvailable(requestedModel?: string): Promise<boolean> {
    const models = await listOllamaModels();
    if (models.length === 0) return false;
    const normalizedRequested = (requestedModel || "").trim().toLowerCase();
    if (normalizedRequested) {
        return models.some((model) => model.toLowerCase() === normalizedRequested);
    }
    return models.some((model) => model.toLowerCase().includes("embed"));
}

async function isTransformersJsAvailable(): Promise<boolean> {
    try {
        await Promise.race([
            importTransformersModule(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
        ]);
        transformersAvailabilityError = null;
        return true;
    } catch (error) {
        transformersAvailabilityError = error instanceof Error ? error.message : String(error);
        return false;
    }
}

type TransformersModuleShape = {
    pipeline: (...args: unknown[]) => Promise<unknown>;
    env?: Record<string, unknown>;
};

type OnnxRuntimeModuleShape = {
    InferenceSession: {
        create: (...args: unknown[]) => Promise<unknown>;
    };
};

let onnxRuntimePrimeError: string | null = null;
let onnxRuntimePrimed = false;

async function importOptionalModule(specifier: string): Promise<Record<string, unknown>> {
    return (await import(specifier)) as Record<string, unknown>;
}

function resolveOnnxRuntimeModule(mod: Record<string, unknown>): OnnxRuntimeModuleShape | null {
    const candidates: unknown[] = [mod];
    if (mod.default && typeof mod.default === "object") {
        candidates.push(mod.default);
    }

    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const inferenceSession = (candidate as Record<string, unknown>).InferenceSession;
        if (!inferenceSession || typeof inferenceSession !== "object") continue;
        const create = (inferenceSession as Record<string, unknown>).create;
        if (typeof create === "function") {
            return candidate as OnnxRuntimeModuleShape;
        }
    }
    return null;
}

async function primeOnnxRuntimeGlobal(): Promise<string | null> {
    if (onnxRuntimePrimed) return null;

    const ortSymbol = Symbol.for("onnxruntime");
    const globalRecord = globalThis as Record<PropertyKey, unknown>;
    const existing = globalRecord[ortSymbol];
    if (existing && typeof existing === "object") {
        const resolved = resolveOnnxRuntimeModule(existing as Record<string, unknown>);
        if (resolved) {
            onnxRuntimePrimed = true;
            onnxRuntimePrimeError = null;
            return null;
        }
    }

    const failures: string[] = [];
    const attempts: Array<{
        label: string;
        loader: () => Promise<Record<string, unknown>>;
    }> = [
        {
            label: "onnxruntime-node",
            loader: async () => await importOptionalModule("onnxruntime-node"),
        },
        {
            label: "onnxruntime-web-dist",
            loader: importOnnxRuntimeWebFallback,
        },
    ];

    for (const attempt of attempts) {
        try {
            const mod = await attempt.loader();
            const resolved = resolveOnnxRuntimeModule(mod);
            if (!resolved) {
                throw new Error("InferenceSession.create is unavailable");
            }
            globalRecord[ortSymbol] = resolved;
            onnxRuntimePrimed = true;
            onnxRuntimePrimeError = null;
            return null;
        } catch (error) {
            failures.push(
                `${attempt.label}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    onnxRuntimePrimeError =
        failures.join(" | ") ||
        "Unable to initialize ONNX runtime backend (node/web)";
    return onnxRuntimePrimeError;
}

async function importOnnxRuntimeWebFallback(): Promise<Record<string, unknown>> {
    const roots = collectSearchRoots();
    const fileNames = [
        "ort.node.min.mjs",
        "ort.all.min.mjs",
        "ort.bundle.min.mjs",
        "ort.min.mjs",
    ];
    let lastError: unknown = null;

    for (const root of roots) {
        for (const fileName of fileNames) {
            const candidatePath = join(root, "node_modules", "onnxruntime-web", "dist", fileName);
            if (!existsSync(candidatePath)) continue;
            try {
                return (await import(pathToFileURL(candidatePath).href)) as Record<string, unknown>;
            } catch (error) {
                lastError = error;
            }
        }
    }

    if (lastError) throw lastError;
    throw new Error("onnxruntime-web dist runtime not found in known node_modules paths");
}

function resolvePipelineExport(value: unknown): ((...args: unknown[]) => Promise<unknown>) | null {
    if (typeof value === "function") {
        return value as (...args: unknown[]) => Promise<unknown>;
    }
    if (!value || typeof value !== "object") {
        return null;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.default === "function") {
        return record.default as (...args: unknown[]) => Promise<unknown>;
    }
    if (typeof record.pipeline === "function") {
        return record.pipeline as (...args: unknown[]) => Promise<unknown>;
    }
    for (const [key, entry] of Object.entries(record)) {
        if (typeof entry === "function" && key.toLowerCase().includes("pipeline")) {
            return entry as (...args: unknown[]) => Promise<unknown>;
        }
    }
    return null;
}

function resolveTransformersModule(mod: Record<string, unknown>): TransformersModuleShape {
    const candidates: Array<Record<string, unknown> | undefined> = [
        mod,
        (mod.default as Record<string, unknown> | undefined) || undefined,
        (mod.pipeline as Record<string, unknown> | undefined) || undefined,
        (mod.default &&
        typeof mod.default === "object" &&
        (mod.default as Record<string, unknown>).pipeline &&
        typeof (mod.default as Record<string, unknown>).pipeline === "object"
            ? ((mod.default as Record<string, unknown>).pipeline as Record<string, unknown>)
            : undefined) ||
            undefined,
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        const pipeline =
            resolvePipelineExport(candidate.pipeline) || resolvePipelineExport(candidate);
        if (pipeline) {
            return {
                pipeline,
                env:
                    candidate.env && typeof candidate.env === "object"
                        ? (candidate.env as Record<string, unknown>)
                        : undefined,
            };
        }
    }

    const keys = Object.keys(mod).slice(0, 20).join(", ");
    const pipelineLike = Object.entries(mod)
        .filter(([key]) => key.toLowerCase().includes("pipeline"))
        .map(([key, value]) => `${key}:${typeof value}`)
        .slice(0, 12)
        .join(", ");
    const pipelineType = typeof (mod as Record<string, unknown>).pipeline;
    throw new Error(
        `Transformers.js module loaded but pipeline export is missing (${keys || "no exports"}; pipeline type: ${pipelineType}; pipeline-like: ${pipelineLike || "none"})`
    );
}

async function importTransformersWebFallback(): Promise<Record<string, unknown>> {
    const candidates = collectTransformersDistCandidates([
        "transformers.web.js",
        "transformers.js",
    ]);

    let lastError: unknown = null;
    for (const candidatePath of candidates) {
        try {
            if (!existsSync(candidatePath)) continue;
            return (await import(pathToFileURL(candidatePath).href)) as Record<string, unknown>;
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) {
        throw lastError;
    }
    throw new Error("Transformers.js web runtime not found in known node_modules paths");
}

function dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const path of paths) {
        if (!path || seen.has(path)) continue;
        seen.add(path);
        unique.push(path);
    }
    return unique;
}

function collectSearchRoots(maxDepth = 8): string[] {
    const seeds = [
        process.cwd(),
        dirname(process.execPath),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const roots: string[] = [];

    for (const seed of seeds) {
        let current = seed;
        for (let depth = 0; depth < maxDepth; depth += 1) {
            roots.push(current);
            const parent = dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }

    return dedupePaths(roots);
}

function collectTransformersDistCandidates(fileNames: string[]): string[] {
    const roots = collectSearchRoots();
    const candidates: string[] = [];
    for (const root of roots) {
        for (const fileName of fileNames) {
            candidates.push(
                join(root, "node_modules", "@huggingface", "transformers", "dist", fileName)
            );
        }
    }
    return dedupePaths(candidates);
}

async function importTransformersNodeFallback(): Promise<Record<string, unknown>> {
    const candidates = collectTransformersDistCandidates([
        "transformers.node.mjs",
        "transformers.node.min.mjs",
        "transformers.node.cjs",
        "transformers.node.min.cjs",
    ]);

    let lastError: unknown = null;
    for (const candidatePath of candidates) {
        try {
            if (!existsSync(candidatePath)) continue;
            return (await import(pathToFileURL(candidatePath).href)) as Record<string, unknown>;
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) throw lastError;
    throw new Error("Transformers.js node runtime not found in known node_modules paths");
}

async function importTransformersModule(): Promise<TransformersModuleShape> {
    const failures: string[] = [];
    const onnxPrimeFailure = await primeOnnxRuntimeGlobal();
    if (onnxPrimeFailure) {
        failures.push(`onnx-prime: ${onnxPrimeFailure}`);
    }

    const attempts: Array<{
        label: string;
        loader: () => Promise<Record<string, unknown>>;
    }> = [
        { label: "node-dist", loader: importTransformersNodeFallback },
        {
            label: "package-import",
            loader: async () => await importOptionalModule("@huggingface/transformers"),
        },
        { label: "web-fallback", loader: importTransformersWebFallback },
    ];

    for (const attempt of attempts) {
        try {
            const mod = await attempt.loader();
            const resolved = resolveTransformersModule(mod);
            transformersAvailabilityError = null;
            return resolved;
        } catch (error) {
            failures.push(
                `${attempt.label}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    throw new Error(
        `Unable to load Transformers.js runtime. Attempts: ${failures.join(" | ")}`
    );
}

async function createOpenAIEmbedding(text: string, apiKey: string, model: string): Promise<number[]> {
    const response = await fetch(OPENAI_EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            input: sanitizeText(text, 8000),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid OpenAI embedding response");
    }
    return embedding;
}

async function createOpenAIEmbeddingBatch(texts: string[], apiKey: string, model: string): Promise<number[][]> {
    const response = await fetch(OPENAI_EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            input: texts.map((text) => sanitizeText(text, 8000)),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
        data?: Array<{ embedding?: number[]; index: number }>;
    };
    if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Invalid OpenAI embedding response");
    }

    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding || []);
}

function createOpenAIProvider(apiKey: string, modelInput?: string): EmbeddingProvider {
    const model = OPENAI_MODELS[modelInput || ""] ? modelInput || OPENAI_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL;
    const dimensions = OPENAI_MODELS[model] || OPENAI_MODELS[OPENAI_DEFAULT_MODEL];
    return {
        id: "openai",
        model,
        dimensions,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("openai", model, text);
            const cached = getFromCache(cacheKey);
            if (cached) return cached;
            const embedding = await createOpenAIEmbedding(text, apiKey, model);
            setCache(cacheKey, embedding);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            const results: (number[] | null)[] = texts.map((text) => {
                const cacheKey = getCacheKey("openai", model, text);
                return getFromCache(cacheKey);
            });

            const uncachedIndices = results
                .map((item, index) => (item === null ? index : -1))
                .filter((index) => index >= 0);

            if (uncachedIndices.length > 0) {
                const uncachedTexts = uncachedIndices.map((index) => texts[index]);
                const newEmbeddings = await createOpenAIEmbeddingBatch(uncachedTexts, apiKey, model);
                uncachedIndices.forEach((originalIndex, newIndex) => {
                    const embedding = newEmbeddings[newIndex];
                    const cacheKey = getCacheKey("openai", model, texts[originalIndex]);
                    setCache(cacheKey, embedding);
                    results[originalIndex] = embedding;
                });
            }

            return results as number[][];
        },
    };
}

async function createVoyageEmbeddingBatch(
    texts: string[],
    apiKey: string,
    model: string,
    inputType: "query" | "document"
): Promise<number[][]> {
    const response = await fetch(VOYAGE_EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            input: texts.map((text) => sanitizeText(text, 16000)),
            input_type: inputType,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Voyage embedding error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
        data?: Array<{ embedding?: number[]; index: number }>;
    };
    if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Invalid Voyage embedding response");
    }
    const sorted = data.data.slice().sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding || []);
}

function createVoyageProvider(apiKey: string, modelInput?: string): EmbeddingProvider {
    const model = VOYAGE_MODELS[modelInput || ""] ? (modelInput as string) : VOYAGE_DEFAULT_MODEL;
    const dimensions = VOYAGE_MODELS[model] || VOYAGE_MODELS[VOYAGE_DEFAULT_MODEL];
    return {
        id: "voyage",
        model,
        dimensions,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("voyage", model, text);
            const cached = getFromCache(cacheKey);
            if (cached) return cached;
            const [embedding] = await createVoyageEmbeddingBatch([text], apiKey, model, "query");
            if (!embedding) throw new Error("Invalid Voyage embedding response");
            setCache(cacheKey, embedding);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            const results: (number[] | null)[] = texts.map((text) =>
                getFromCache(getCacheKey("voyage", model, text))
            );
            const uncachedIndices = results
                .map((item, index) => (item === null ? index : -1))
                .filter((index) => index >= 0);
            if (uncachedIndices.length > 0) {
                const uncachedTexts = uncachedIndices.map((index) => texts[index]);
                const embeddings = await createVoyageEmbeddingBatch(
                    uncachedTexts,
                    apiKey,
                    model,
                    "document"
                );
                uncachedIndices.forEach((originalIndex, newIndex) => {
                    const embedding = embeddings[newIndex];
                    if (embedding) {
                        setCache(getCacheKey("voyage", model, texts[originalIndex]), embedding);
                        results[originalIndex] = embedding;
                    }
                });
            }
            return results.map((item) => item || []);
        },
    };
}

async function createGeminiEmbedding(text: string, apiKey: string, model: string): Promise<number[]> {
    const endpoint = `${GEMINI_EMBEDDING_ENDPOINT}/${model}:embedContent?key=${apiKey}`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: `models/${model}`,
            content: {
                parts: [{ text: sanitizeText(text, 10000) }],
            },
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini embedding error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
        embedding?: { values?: number[] };
    };
    const embedding = data.embedding?.values;
    if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid Gemini embedding response");
    }
    return embedding;
}

function createGeminiProvider(apiKey: string, modelInput?: string): EmbeddingProvider {
    const model = GEMINI_MODELS[modelInput || ""] ? modelInput || GEMINI_DEFAULT_MODEL : GEMINI_DEFAULT_MODEL;
    const dimensions = GEMINI_MODELS[model] || GEMINI_MODELS[GEMINI_DEFAULT_MODEL];
    return {
        id: "gemini",
        model,
        dimensions,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("gemini", model, text);
            const cached = getFromCache(cacheKey);
            if (cached) return cached;
            const embedding = await createGeminiEmbedding(text, apiKey, model);
            setCache(cacheKey, embedding);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            const results: number[][] = [];
            for (const text of texts) {
                const cacheKey = getCacheKey("gemini", model, text);
                const cached = getFromCache(cacheKey);
                if (cached) {
                    results.push(cached);
                } else {
                    const embedding = await createGeminiEmbedding(text, apiKey, model);
                    setCache(cacheKey, embedding);
                    results.push(embedding);
                }
            }
            return results;
        },
    };
}

async function createOllamaEmbedding(text: string, model: string): Promise<number[]> {
    const response = await fetch(OLLAMA_EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            prompt: sanitizeText(text, 12000),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama embedding error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as { embedding?: number[] };
    if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error("Invalid Ollama embedding response");
    }
    return data.embedding;
}

function createOllamaProvider(modelInput?: string): EmbeddingProvider {
    const model = modelInput && modelInput.trim() ? modelInput.trim() : OLLAMA_DEFAULT_MODEL;
    return {
        id: "ollama",
        model,
        dimensions: 0,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("ollama", model, text);
            const cached = getFromCache(cacheKey);
            if (cached) return cached;
            const embedding = await createOllamaEmbedding(text, model);
            setCache(cacheKey, embedding);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            const results: number[][] = [];
            for (const text of texts) {
                const cacheKey = getCacheKey("ollama", model, text);
                const cached = getFromCache(cacheKey);
                if (cached) {
                    results.push(cached);
                } else {
                    const embedding = await createOllamaEmbedding(text, model);
                    setCache(cacheKey, embedding);
                    results.push(embedding);
                }
            }
            return results;
        },
    };
}

async function getTransformersExtractor(modelInput?: string): Promise<unknown> {
    const model = modelInput && modelInput.trim() ? modelInput.trim() : TRANSFORMERS_DEFAULT_MODEL;
    const cached = transformersExtractorCache.get(model);
    if (cached) {
        touchTransformersModel(model);
        const runtime = getRuntimeEntry(model);
        if (runtime.state === "idle") {
            updateRuntimeEntry(model, { state: "loading" });
        }
        return cached;
    }

    updateRuntimeEntry(model, {
        state: "loading",
        lastError: null,
        lastUsedAt: Date.now(),
    });

    const pending = (async () => {
        const transformersModule = await importTransformersModule();
        if (transformersModule.env && typeof transformersModule.env === "object") {
            try {
                if (!existsSync(TRANSFORMERS_CACHE_DIR)) {
                    mkdirSync(TRANSFORMERS_CACHE_DIR, { recursive: true });
                }
                const cachedModel = existsSync(join(TRANSFORMERS_CACHE_DIR, model));
                transformersModule.env.allowRemoteModels = true;
                transformersModule.env.allowLocalModels = cachedModel;
                transformersModule.env.cacheDir = TRANSFORMERS_CACHE_DIR;
                transformersModule.env.localModelPath = TRANSFORMERS_CACHE_DIR;
                if (transformersModule.env.backends && typeof transformersModule.env.backends === "object") {
                    const backends = transformersModule.env.backends as Record<string, unknown>;
                    const onnx = backends.onnx as Record<string, unknown> | undefined;
                    if (onnx && typeof onnx === "object") {
                        onnx.numThreads = 1;
                    }
                }
            } catch {
                void 0;
            }
        }
        return await transformersModule.pipeline("feature-extraction", model, { quantized: true });
    })();

    transformersExtractorCache.set(model, pending);
    try {
        const extractor = await pending;
        updateRuntimeEntry(model, {
            state: "ready",
            loadedAt: getRuntimeEntry(model).loadedAt || Date.now(),
            lastUsedAt: Date.now(),
            lastError: null,
        });
        return extractor;
    } catch (error) {
        transformersExtractorCache.delete(model);
        updateRuntimeEntry(model, {
            state: "error",
            lastUsedAt: Date.now(),
            lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}

function asNumericArray(value: unknown): number[] {
    if (Array.isArray(value)) {
        if (value.length === 0) return [];
        if (typeof value[0] === "number") {
            return (value as number[]).map((item) => Number(item));
        }
        if (Array.isArray(value[0])) {
            const nested = value[0] as unknown[];
            return nested
                .filter((item): item is number => typeof item === "number")
                .map((item) => Number(item));
        }
    }

    const tensorLike = value as {
        data?: ArrayLike<number>;
        tolist?: () => unknown;
    };
    if (tensorLike?.data && typeof tensorLike.data.length === "number") {
        return Array.from(tensorLike.data, (item) => Number(item));
    }
    if (typeof tensorLike?.tolist === "function") {
        return asNumericArray(tensorLike.tolist());
    }
    return [];
}

function asNumericMatrix(value: unknown): number[][] {
    if (Array.isArray(value)) {
        if (value.length === 0) return [];
        if (Array.isArray(value[0])) {
            return (value as unknown[][]).map((row) =>
                row.filter((item): item is number => typeof item === "number").map((item) => Number(item))
            );
        }
        if (typeof value[0] === "number") {
            return [asNumericArray(value)];
        }
    }

    const tensorLike = value as {
        data?: ArrayLike<number>;
        dims?: number[];
        tolist?: () => unknown;
    };
    if (tensorLike?.data && Array.isArray(tensorLike?.dims) && tensorLike.dims.length >= 2) {
        const [rows, cols] = tensorLike.dims;
        if (rows > 0 && cols > 0) {
            const values = Array.from(tensorLike.data, (item) => Number(item));
            const matrix: number[][] = [];
            for (let row = 0; row < rows; row += 1) {
                const start = row * cols;
                matrix.push(values.slice(start, start + cols));
            }
            return matrix;
        }
    }
    if (typeof tensorLike?.tolist === "function") {
        return asNumericMatrix(tensorLike.tolist());
    }
    const single = asNumericArray(value);
    return single.length ? [single] : [];
}

function createTransformersProvider(modelInput?: string): EmbeddingProvider {
    const model = modelInput && modelInput.trim() ? modelInput.trim() : TRANSFORMERS_DEFAULT_MODEL;
    return {
        id: "transformers_js",
        model,
        dimensions: 0,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("transformers_js", model, text);
            const cached = getFromCache(cacheKey);
            if (cached) {
                touchTransformersModel(model);
                return cached;
            }

            const extractor = (await getTransformersExtractor(model)) as (
                input: string,
                options?: Record<string, unknown>
            ) => Promise<unknown>;
            const output = await extractor(sanitizeText(text, 4000), {
                pooling: "mean",
                normalize: true,
            });
            const embedding = asNumericArray(output);
            if (!embedding.length) {
                throw new Error("Transformers.js returned empty embedding");
            }
            setCache(cacheKey, embedding);
            touchTransformersModel(model);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            if (texts.length === 0) return [];
            const extractor = (await getTransformersExtractor(model)) as (
                input: string[],
                options?: Record<string, unknown>
            ) => Promise<unknown>;

            const uncachedTexts: string[] = [];
            const uncachedMapIndices: number[] = [];
            const cachedResults: (number[] | null)[] = texts.map((text, index) => {
                const cacheKey = getCacheKey("transformers_js", model, text);
                const cached = getFromCache(cacheKey);
                if (!cached) {
                    uncachedTexts.push(sanitizeText(text, 4000));
                    uncachedMapIndices.push(index);
                }
                return cached;
            });

            if (uncachedTexts.length > 0) {
                const output = await extractor(uncachedTexts, {
                    pooling: "mean",
                    normalize: true,
                });
                const matrix = asNumericMatrix(output);
                uncachedMapIndices.forEach((originalIndex, newIndex) => {
                    const embedding = matrix[newIndex] || [];
                    const cacheKey = getCacheKey("transformers_js", model, texts[originalIndex]);
                    if (embedding.length) {
                        setCache(cacheKey, embedding);
                    }
                    cachedResults[originalIndex] = embedding;
                });
            }

            touchTransformersModel(model);
            return cachedResults.map((item) => item || []);
        },
    };
}

function createNullProvider(): EmbeddingProvider {
    return {
        id: "none",
        model: "none",
        dimensions: 0,
        embedQuery: async () => [],
        embedBatch: async (texts) => texts.map(() => []),
    };
}

async function tryCreateProvider(
    provider: EmbeddingProviderPreference,
    model: string
): Promise<EmbeddingProviderResult> {
    if (provider === "openai") {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
            return {
                provider: createNullProvider(),
                source: "none",
                fallbackReason: "OPENAI_API_KEY is not set",
            };
        }
        const embeddingProvider = createOpenAIProvider(apiKey, model);
        await embeddingProvider.embedQuery("health check");
        return { provider: embeddingProvider, source: "openai" };
    }

    if (provider === "voyage") {
        const apiKey = process.env.VOYAGE_API_KEY?.trim();
        if (!apiKey) {
            return {
                provider: createNullProvider(),
                source: "none",
                fallbackReason: "VOYAGE_API_KEY is not set",
            };
        }
        const embeddingProvider = createVoyageProvider(apiKey, model);
        await embeddingProvider.embedQuery("health check");
        return { provider: embeddingProvider, source: "voyage" };
    }

    if (provider === "gemini") {
        const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
        if (!apiKey) {
            return {
                provider: createNullProvider(),
                source: "none",
                fallbackReason: "GEMINI_API_KEY/GOOGLE_API_KEY is not set",
            };
        }
        const embeddingProvider = createGeminiProvider(apiKey, model);
        await embeddingProvider.embedQuery("health check");
        return { provider: embeddingProvider, source: "gemini" };
    }

    if (provider === "ollama") {
        const selectedModel = model || OLLAMA_DEFAULT_MODEL;
        if (!(await isOllamaAvailable(selectedModel))) {
            return {
                provider: createNullProvider(),
                source: "none",
                fallbackReason: `Ollama model not available: ${selectedModel}`,
            };
        }
        const embeddingProvider = createOllamaProvider(selectedModel);
        const check = await embeddingProvider.embedQuery("health check");
        const dimensions = check.length;
        return {
            provider: { ...embeddingProvider, dimensions },
            source: "ollama",
        };
    }

    if (provider === "transformers_js") {
        if (!(await isTransformersJsAvailable())) {
            return {
                provider: createNullProvider(),
                source: "none",
                fallbackReason:
                    transformersAvailabilityError ||
                    "Transformers.js package is not installed",
            };
        }
        const embeddingProvider = createTransformersProvider(model || TRANSFORMERS_DEFAULT_MODEL);
        const check = await embeddingProvider.embedQuery("health check");
        return {
            provider: { ...embeddingProvider, dimensions: check.length },
            source: "transformers_js",
        };
    }

    return {
        provider: createNullProvider(),
        source: "none",
        fallbackReason: `Unsupported embedding provider: ${provider}`,
    };
}

export async function createEmbeddingProvider(selection?: EmbeddingSelection): Promise<EmbeddingProviderResult> {
    const normalized = normalizeSelection(selection);
    if (normalized.provider !== "auto") {
        try {
            return await tryCreateProvider(normalized.provider, normalized.model);
        } catch (error) {
            return {
                provider: createNullProvider(),
                source: "none",
                fallbackReason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    const candidates: Array<{ provider: EmbeddingProviderPreference; model: string }> = [
        { provider: "openai", model: normalized.model || OPENAI_DEFAULT_MODEL },
        { provider: "voyage", model: normalized.model || VOYAGE_DEFAULT_MODEL },
        { provider: "gemini", model: normalized.model || GEMINI_DEFAULT_MODEL },
        { provider: "ollama", model: normalized.model || OLLAMA_DEFAULT_MODEL },
        { provider: "transformers_js", model: normalized.model || TRANSFORMERS_DEFAULT_MODEL },
    ];

    const failureReasons: string[] = [];
    for (const candidate of candidates) {
        try {
            const result = await tryCreateProvider(candidate.provider, candidate.model);
            if (result.source !== "none") {
                if (failureReasons.length > 0 && !result.fallbackReason) {
                    result.fallbackReason = failureReasons.join(" | ");
                }
                return result;
            }
            if (result.fallbackReason) failureReasons.push(result.fallbackReason);
        } catch (error) {
            failureReasons.push(error instanceof Error ? error.message : String(error));
        }
    }

    return {
        provider: createNullProvider(),
        source: "none",
        fallbackReason:
            failureReasons.join(" | ") ||
            "No embedding provider available (configure API keys, Ollama, or Transformers.js)",
    };
}

export async function getEmbeddingProviderCatalog(selection?: EmbeddingSelection): Promise<EmbeddingProviderCatalog> {
    const normalized = normalizeSelection(selection);
    const openaiAvailable = Boolean(process.env.OPENAI_API_KEY?.trim());
    const voyageAvailable = Boolean(process.env.VOYAGE_API_KEY?.trim());
    const geminiAvailable = Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim());
    const ollamaModels = await listOllamaModels();
    const ollamaAvailable = ollamaModels.length > 0;
    const transformersAvailable = await isTransformersJsAvailable();

    const ollamaModelList = [...new Set([...OLLAMA_RECOMMENDED_MODELS, ...ollamaModels])];
    const selectedModel = normalized.model || "";

    return {
        selected: {
            provider: normalized.provider,
            model: selectedModel,
        },
        providers: [
            {
                id: "auto",
                label: "Auto (best available)",
                local: false,
                available: true,
                defaultModel: "",
                models: [],
            },
            {
                id: "openai",
                label: "OpenAI",
                local: false,
                available: openaiAvailable,
                reason: openaiAvailable ? undefined : "OPENAI_API_KEY is not set",
                defaultModel: OPENAI_DEFAULT_MODEL,
                models: Object.keys(OPENAI_MODELS),
            },
            {
                id: "voyage",
                label: "Voyage AI",
                local: false,
                available: voyageAvailable,
                reason: voyageAvailable ? undefined : "VOYAGE_API_KEY is not set",
                defaultModel: VOYAGE_DEFAULT_MODEL,
                models: Object.keys(VOYAGE_MODELS),
            },
            {
                id: "gemini",
                label: "Gemini",
                local: false,
                available: geminiAvailable,
                reason: geminiAvailable ? undefined : "GEMINI_API_KEY/GOOGLE_API_KEY is not set",
                defaultModel: GEMINI_DEFAULT_MODEL,
                models: Object.keys(GEMINI_MODELS),
            },
            {
                id: "ollama",
                label: "Ollama (local)",
                local: true,
                available: ollamaAvailable,
                reason: ollamaAvailable ? undefined : "Ollama is not running or no embedding models are installed",
                defaultModel: OLLAMA_DEFAULT_MODEL,
                models: ollamaModelList,
            },
            {
                id: "transformers_js",
                label: "Transformers.js (local)",
                local: true,
                available: transformersAvailable,
                reason: transformersAvailable
                    ? undefined
                    : transformersAvailabilityError ||
                      "Install @huggingface/transformers to enable local in-process embeddings",
                defaultModel: TRANSFORMERS_DEFAULT_MODEL,
                models: [...TRANSFORMERS_RECOMMENDED_MODELS],
            },
        ],
    };
}

export function getTransformersRuntimeStatus(selectedModelInput?: string): TransformersRuntimeStatus {
    const selectedModel =
        selectedModelInput && selectedModelInput.trim() ? selectedModelInput.trim() : TRANSFORMERS_DEFAULT_MODEL;
    const models = Array.from(
        new Set<string>([
            ...Array.from(transformersRuntimeState.keys()),
            ...Array.from(transformersExtractorCache.keys()),
            selectedModel,
        ])
    );

    const loadedModels = models
        .map((model) => {
            const state = getRuntimeEntry(model);
            const normalizedState: LocalRuntimeState =
                transformersExtractorCache.has(model) && state.state === "idle" ? "loading" : state.state;
            return {
                model,
                state: normalizedState,
                loadedAt: toIsoTime(state.loadedAt),
                lastUsedAt: toIsoTime(state.lastUsedAt),
                lastError: state.lastError || null,
            } satisfies TransformersRuntimeModelStatus;
        })
        .sort((left, right) => {
            if (left.model === selectedModel) return -1;
            if (right.model === selectedModel) return 1;
            const leftWeight = left.state === "ready" ? 0 : left.state === "loading" ? 1 : left.state === "error" ? 2 : 3;
            const rightWeight = right.state === "ready" ? 0 : right.state === "loading" ? 1 : right.state === "error" ? 2 : 3;
            if (leftWeight !== rightWeight) return leftWeight - rightWeight;
            return left.model.localeCompare(right.model);
        });

    const selectedState =
        loadedModels.find((entry) => entry.model === selectedModel)?.state || "idle";

    return {
        selectedModel,
        selectedState,
        loadedModels,
    };
}

export async function loadEmbeddingRuntime(selection?: EmbeddingSelection): Promise<EmbeddingRuntimeLoadResult> {
    const normalized = normalizeSelection(selection);
    const provider = normalized.provider;
    const model = normalized.model;

    if (provider === "transformers_js") {
        const selectedModel = model || TRANSFORMERS_DEFAULT_MODEL;
        if (!(await isTransformersJsAvailable())) {
            updateRuntimeEntry(selectedModel, {
                state: "error",
                lastUsedAt: Date.now(),
                lastError: transformersAvailabilityError || "Transformers.js package is not installed",
            });
            return {
                success: false,
                provider: "transformers_js",
                model: selectedModel,
                message:
                    transformersAvailabilityError ||
                    "Transformers.js package is not installed",
            };
        }

        try {
            const runtimeProvider = createTransformersProvider(selectedModel);
            const embedding = await runtimeProvider.embedQuery("health check");
            updateRuntimeEntry(selectedModel, {
                state: "ready",
                loadedAt: getRuntimeEntry(selectedModel).loadedAt || Date.now(),
                lastUsedAt: Date.now(),
                lastError: null,
            });
            return {
                success: true,
                provider: "transformers_js",
                model: selectedModel,
                message: `Loaded Transformers.js model (${embedding.length} dims): ${selectedModel}`,
            };
        } catch (error) {
            updateRuntimeEntry(selectedModel, {
                state: "error",
                lastUsedAt: Date.now(),
                lastError: error instanceof Error ? error.message : String(error),
            });
            return {
                success: false,
                provider: "transformers_js",
                model: selectedModel,
                message: `Failed to load Transformers.js model: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    if (provider === "ollama") {
        const selectedModel = model || OLLAMA_DEFAULT_MODEL;
        if (!(await isOllamaAvailable(selectedModel))) {
            return {
                success: false,
                provider: "ollama",
                model: selectedModel,
                message: `Ollama model not available: ${selectedModel}`,
            };
        }
        try {
            await createOllamaEmbedding("health check", selectedModel);
            return {
                success: true,
                provider: "ollama",
                model: selectedModel,
                message: `Loaded Ollama embedding model: ${selectedModel}`,
            };
        } catch (error) {
            return {
                success: false,
                provider: "ollama",
                model: selectedModel,
                message: `Failed to load Ollama model: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    return {
        success: false,
        provider,
        model,
        message: "Select a local provider (Transformers.js or Ollama) to manage runtime loading",
    };
}

export async function stopEmbeddingRuntime(selection?: EmbeddingSelection): Promise<EmbeddingRuntimeStopResult> {
    const normalized = normalizeSelection(selection);
    const provider = normalized.provider;
    const model = normalized.model;

    if (provider === "transformers_js") {
        const selectedModel = model || "";
        if (!selectedModel) {
            for (const loadedModel of transformersExtractorCache.keys()) {
                transformersExtractorCache.delete(loadedModel);
                clearProviderCache("transformers_js", loadedModel);
                transformersRuntimeState.delete(loadedModel);
            }
            for (const knownModel of transformersRuntimeState.keys()) {
                transformersRuntimeState.delete(knownModel);
            }
            return {
                success: true,
                provider: "transformers_js",
                model: "all",
                message: "Unloaded all local Transformers.js models",
            };
        }
        transformersExtractorCache.delete(selectedModel);
        clearProviderCache("transformers_js", selectedModel);
        transformersRuntimeState.delete(selectedModel);
        return {
            success: true,
            provider: "transformers_js",
            model: selectedModel,
            message: `Unloaded local Transformers.js model: ${selectedModel}`,
        };
    }

    if (provider === "ollama") {
        const selectedModel = model || OLLAMA_DEFAULT_MODEL;
        try {
            const response = await fetch(OLLAMA_GENERATE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: selectedModel,
                    prompt: "",
                    stream: false,
                    keep_alive: 0,
                }),
            });
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`${response.status} ${error}`);
            }
            clearProviderCache("ollama", selectedModel);
            return {
                success: true,
                provider: "ollama",
                model: selectedModel,
                message: `Requested Ollama model unload: ${selectedModel}`,
            };
        } catch (error) {
            return {
                success: false,
                provider: "ollama",
                model: selectedModel,
                message: `Failed to stop Ollama model: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    return {
        success: false,
        provider,
        model,
        message: "Selected embedding provider does not run as a local runtime",
    };
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;
    return dotProduct / magnitude;
}

export function findTopKSimilar(
    queryVec: number[],
    candidates: Array<{ id: string; embedding: number[] }>,
    k: number
): Array<{ id: string; score: number }> {
    if (queryVec.length === 0) return [];
    const scored = candidates
        .map((candidate) => ({
            id: candidate.id,
            score: cosineSimilarity(queryVec, candidate.embedding),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);
    return scored.slice(0, k);
}
