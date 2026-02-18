
export interface EmbeddingProvider {
    id: string;
    model: string;
    dimensions: number;
    embedQuery: (text: string) => Promise<number[]>;
    embedBatch: (texts: string[]) => Promise<number[][]>;
}

export interface EmbeddingProviderResult {
    provider: EmbeddingProvider;
    source: "openai" | "gemini" | "ollama" | "none";
    fallbackReason?: string;
}

const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
    if (embeddingCache.size > 1000) {
        const entries = Array.from(embeddingCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, 500);
        entries.forEach(([k]) => embeddingCache.delete(k));
    }
}

const OPENAI_EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_DIMENSIONS = 1536;

async function createOpenAIEmbedding(text: string, apiKey: string): Promise<number[]> {
    const response = await fetch(OPENAI_EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: OPENAI_EMBEDDING_MODEL,
            input: text.trim().slice(0, 8000), // OpenAI limit
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
        data?: Array<{ embedding?: number[] }>;
    };

    const embedding = data.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid OpenAI embedding response");
    }

    return embedding;
}

async function createOpenAIEmbeddingBatch(texts: string[], apiKey: string): Promise<number[][]> {
    const response = await fetch(OPENAI_EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: OPENAI_EMBEDDING_MODEL,
            input: texts.map(t => t.trim().slice(0, 8000)),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
        data?: Array<{ embedding?: number[]; index: number }>;
    };

    if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Invalid OpenAI embedding response");
    }

    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map(item => item.embedding || []);
}

function createOpenAIProvider(apiKey: string): EmbeddingProvider {
    return {
        id: "openai",
        model: OPENAI_EMBEDDING_MODEL,
        dimensions: OPENAI_EMBEDDING_DIMENSIONS,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("openai", OPENAI_EMBEDDING_MODEL, text);
            const cached = getFromCache(cacheKey);
            if (cached) return cached;

            const embedding = await createOpenAIEmbedding(text, apiKey);
            setCache(cacheKey, embedding);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            const results: (number[] | null)[] = texts.map(text => {
                const cacheKey = getCacheKey("openai", OPENAI_EMBEDDING_MODEL, text);
                return getFromCache(cacheKey);
            });

            const uncachedIndices = results
                .map((r, i) => r === null ? i : -1)
                .filter(i => i !== -1);

            if (uncachedIndices.length > 0) {
                const uncachedTexts = uncachedIndices.map(i => texts[i]);
                const newEmbeddings = await createOpenAIEmbeddingBatch(uncachedTexts, apiKey);

                uncachedIndices.forEach((originalIndex, newIndex) => {
                    const embedding = newEmbeddings[newIndex];
                    const cacheKey = getCacheKey("openai", OPENAI_EMBEDDING_MODEL, texts[originalIndex]);
                    setCache(cacheKey, embedding);
                    results[originalIndex] = embedding;
                });
            }

            return results as number[][];
        },
    };
}

const OLLAMA_EMBEDDING_ENDPOINT = "http://localhost:11434/api/embeddings";
const OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";
const OLLAMA_EMBEDDING_DIMENSIONS = 768;

async function createOllamaEmbedding(text: string): Promise<number[]> {
    const response = await fetch(OLLAMA_EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: OLLAMA_EMBEDDING_MODEL,
            prompt: text.trim(),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
        embedding?: number[];
    };

    if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error("Invalid Ollama embedding response");
    }

    return data.embedding;
}

function createOllamaProvider(): EmbeddingProvider {
    return {
        id: "ollama",
        model: OLLAMA_EMBEDDING_MODEL,
        dimensions: OLLAMA_EMBEDDING_DIMENSIONS,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("ollama", OLLAMA_EMBEDDING_MODEL, text);
            const cached = getFromCache(cacheKey);
            if (cached) return cached;

            const embedding = await createOllamaEmbedding(text);
            setCache(cacheKey, embedding);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            const results: number[][] = [];
            for (const text of texts) {
                const cacheKey = getCacheKey("ollama", OLLAMA_EMBEDDING_MODEL, text);
                const cached = getFromCache(cacheKey);
                if (cached) {
                    results.push(cached);
                } else {
                    const embedding = await createOllamaEmbedding(text);
                    setCache(cacheKey, embedding);
                    results.push(embedding);
                }
            }
            return results;
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

const GEMINI_EMBEDDING_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
const GEMINI_EMBEDDING_DIMENSIONS = 768;

async function createGeminiEmbedding(text: string, apiKey: string): Promise<number[]> {
    const response = await fetch(`${GEMINI_EMBEDDING_ENDPOINT}?key=${apiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: {
                parts: [{ text: text.trim().slice(0, 10000) }],
            },
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
        embedding?: { values?: number[] };
    };

    const embedding = data.embedding?.values;
    if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid Gemini embedding response");
    }

    return embedding;
}

function createGeminiProvider(apiKey: string): EmbeddingProvider {
    return {
        id: "gemini",
        model: GEMINI_EMBEDDING_MODEL,
        dimensions: GEMINI_EMBEDDING_DIMENSIONS,
        embedQuery: async (text: string) => {
            const cacheKey = getCacheKey("gemini", GEMINI_EMBEDDING_MODEL, text);
            const cached = getFromCache(cacheKey);
            if (cached) return cached;

            const embedding = await createGeminiEmbedding(text, apiKey);
            setCache(cacheKey, embedding);
            return embedding;
        },
        embedBatch: async (texts: string[]) => {
            const results: number[][] = [];
            for (const text of texts) {
                const cacheKey = getCacheKey("gemini", GEMINI_EMBEDDING_MODEL, text);
                const cached = getFromCache(cacheKey);
                if (cached) {
                    results.push(cached);
                } else {
                    const embedding = await createGeminiEmbedding(text, apiKey);
                    setCache(cacheKey, embedding);
                    results.push(embedding);
                }
            }
            return results;
        },
    };
}

async function isOllamaAvailable(): Promise<boolean> {
    try {
        const response = await fetch("http://localhost:11434/api/tags", {
            method: "GET",
            signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return false;

        const data = await response.json() as { models?: Array<{ name?: string }> };
        const models = data.models || [];
        return models.some(m => m.name?.includes("nomic-embed") || m.name?.includes("embed"));
    } catch {
        return false;
    }
}

export async function createEmbeddingProvider(): Promise<EmbeddingProviderResult> {
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (openaiKey) {
        try {
            const provider = createOpenAIProvider(openaiKey);
            await provider.embedQuery("test");
            return { provider, source: "openai" };
        } catch (error) {
            console.warn("[Embeddings] OpenAI failed:", (error as Error).message);
        }
    }

    const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    if (geminiKey) {
        try {
            const provider = createGeminiProvider(geminiKey);
            await provider.embedQuery("test");
            return {
                provider,
                source: "gemini",
                fallbackReason: openaiKey ? "OpenAI failed" : "No OpenAI API key",
            };
        } catch (error) {
            console.warn("[Embeddings] Gemini failed:", (error as Error).message);
        }
    }

    if (await isOllamaAvailable()) {
        try {
            const provider = createOllamaProvider();
            await provider.embedQuery("test");
            return {
                provider,
                source: "ollama",
                fallbackReason: openaiKey || geminiKey ? "Cloud providers failed" : "No cloud API keys",
            };
        } catch (error) {
            console.warn("[Embeddings] Ollama failed:", (error as Error).message);
        }
    }

    return {
        provider: createNullProvider(),
        source: "none",
        fallbackReason: "No embedding provider available (set OPENAI_API_KEY, GEMINI_API_KEY, or run Ollama)",
    };
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
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
        .map(c => ({
            id: c.id,
            score: cosineSimilarity(queryVec, c.embedding),
        }))
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score);

    return scored.slice(0, k);
}
