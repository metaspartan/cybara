import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
    createEmbeddingProvider,
    findTopKSimilar,
    getTransformersRuntimeStatus,
    loadEmbeddingRuntime,
    stopEmbeddingRuntime,
    type EmbeddingRuntimeLoadResult,
    type EmbeddingProvider,
    type EmbeddingProviderId,
    type EmbeddingSelection,
} from "./embeddings";

const MEMORY_DIR = join(process.env.HOME || process.env.USERPROFILE || homedir(), ".cybara", "memory");
const VECTOR_DB_PATH = join(MEMORY_DIR, "vectors.db");

export interface MemoryChunk {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    embedding: number[];
    source: "memory" | "sessions" | "workspace";
    createdAt: number;
    hash: string;
}

export interface VectorSearchResult {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
    source: "memory" | "sessions" | "workspace";
}

function hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i += 1) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash &= hash;
    }
    return hash.toString(16);
}

function normalizeSelection(selection?: EmbeddingSelection): Required<EmbeddingSelection> {
    return {
        provider: typeof selection?.provider === "string" ? selection.provider : "auto",
        model: typeof selection?.model === "string" ? selection.model.trim().slice(0, 180) : "",
    };
}

function selectionKey(selection: Required<EmbeddingSelection>): string {
    return `${selection.provider}:${selection.model}`;
}

export function chunkMarkdown(
    content: string,
    maxTokens: number = 500
): Array<{ text: string; startLine: number; endLine: number }> {
    const lines = content.split("\n");
    const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

    let currentChunk: string[] = [];
    let currentStartLine = 1;
    let currentTokens = 0;
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineTokens = estimateTokens(line);
        const isHeader = /^#{1,6}\s/.test(line);

        if (isHeader && currentChunk.length > 0) {
            chunks.push({
                text: currentChunk.join("\n"),
                startLine: currentStartLine,
                endLine: i,
            });
            currentChunk = [line];
            currentStartLine = i + 1;
            currentTokens = lineTokens;
            continue;
        }

        if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
            chunks.push({
                text: currentChunk.join("\n"),
                startLine: currentStartLine,
                endLine: i,
            });
            currentChunk = [line];
            currentStartLine = i + 1;
            currentTokens = lineTokens;
            continue;
        }

        currentChunk.push(line);
        currentTokens += lineTokens;
    }

    if (currentChunk.length > 0) {
        chunks.push({
            text: currentChunk.join("\n"),
            startLine: currentStartLine,
            endLine: lines.length,
        });
    }

    return chunks.filter((chunk) => chunk.text.trim().length > 10);
}

export class VectorStore {
    private db: Database;
    private provider: EmbeddingProvider | null = null;
    private providerReady: Promise<void>;
    private providerSource: EmbeddingProviderId = "none";
    private providerFallbackReason: string | null = null;
    private chunks: Map<string, MemoryChunk> = new Map();
    private embeddingSelection: Required<EmbeddingSelection> = {
        provider: "auto",
        model: "",
    };

    constructor() {
        if (!existsSync(MEMORY_DIR)) {
            mkdirSync(MEMORY_DIR, { recursive: true });
        }

        this.db = new Database(VECTOR_DB_PATH);
        this.initSchema();
        this.loadChunks();
        this.providerReady = this.initProvider();
    }

    private initSchema(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(hash);
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
    `);
    }

    private loadChunks(): void {
        const rows = this.db
            .query(
                "SELECT id, path, start_line, end_line, content, embedding, source, created_at, hash FROM chunks"
            )
            .all() as Array<{
            id: string;
            path: string;
            start_line: number;
            end_line: number;
            content: string;
            embedding: string;
            source: string;
            created_at: number;
            hash: string;
        }>;

        for (const row of rows) {
            try {
                const embedding = JSON.parse(row.embedding) as number[];
                this.chunks.set(row.id, {
                    id: row.id,
                    path: row.path,
                    startLine: row.start_line,
                    endLine: row.end_line,
                    content: row.content,
                    embedding,
                    source: row.source as "memory" | "sessions" | "workspace",
                    createdAt: row.created_at,
                    hash: row.hash,
                });
            } catch {
                // Corrupt rows are ignored and can be rebuilt.
            }
        }

        console.log(`[VectorStore] Loaded ${this.chunks.size} chunks from database`);
    }

    private async initProvider(): Promise<void> {
        const result = await createEmbeddingProvider(this.embeddingSelection);
        this.provider = result.provider;
        this.providerSource = result.source;
        this.providerFallbackReason = result.fallbackReason || null;

        if (result.source === "none") {
            console.warn("[VectorStore] No embedding provider available:", result.fallbackReason);
        } else {
            console.log(
                `[VectorStore] Using ${result.source} embeddings (${result.provider.model}) with selection ${selectionKey(this.embeddingSelection)}`
            );
        }
    }

    async ensureReady(): Promise<void> {
        await this.providerReady;
    }

    async configureEmbeddings(selection?: EmbeddingSelection): Promise<void> {
        const normalized = normalizeSelection(selection);
        if (selectionKey(normalized) === selectionKey(this.embeddingSelection)) {
            return;
        }
        this.embeddingSelection = normalized;
        this.provider = null;
        this.providerSource = "none";
        this.providerFallbackReason = null;
        this.providerReady = this.initProvider();
        await this.providerReady;
    }

    async stopLocalRuntime(selection?: EmbeddingSelection): Promise<{
        success: boolean;
        provider: string;
        model: string;
        message: string;
    }> {
        const requested = normalizeSelection(selection);
        const provider =
            requested.provider !== "auto"
                ? requested.provider
                : this.providerSource !== "none"
                    ? this.providerSource
                    : this.embeddingSelection.provider;
        const model = requested.model || this.provider?.model || this.embeddingSelection.model || "";
        return await stopEmbeddingRuntime({
            provider: provider as EmbeddingSelection["provider"],
            model,
        });
    }

    async startLocalRuntime(selection?: EmbeddingSelection): Promise<EmbeddingRuntimeLoadResult> {
        const requested = normalizeSelection(selection);
        const requestedProvider = requested.provider;
        if (requestedProvider !== "ollama" && requestedProvider !== "transformers_js") {
            return {
                success: false,
                provider: requestedProvider,
                model: requested.model,
                message: "Select a local provider (Transformers.js or Ollama) to load runtime",
            };
        }

        if (selectionKey(requested) !== selectionKey(this.embeddingSelection)) {
            await this.configureEmbeddings(requested);
        } else {
            await this.ensureReady();
        }

        const provider = requestedProvider;
        const model = requested.model || this.provider?.model || this.embeddingSelection.model || "";
        return await loadEmbeddingRuntime({
            provider,
            model,
        });
    }

    getLocalRuntimeStatus(selection?: EmbeddingSelection): {
        selectedProvider: string;
        selectedModel: string;
        vectorProvider: string;
        vectorModel: string;
        vectorFallbackReason: string | null;
        transformers: ReturnType<typeof getTransformersRuntimeStatus>;
    } {
        const requested = normalizeSelection(selection);
        const selectedProvider = requested.provider;
        const selectedModel = requested.model;
        const vectorProvider = this.provider?.id || "none";
        const vectorModel = this.provider?.model || "none";

        const transformerTargetModel =
            selectedProvider === "transformers_js"
                ? selectedModel || this.provider?.model || ""
                : selectedModel || "";

        return {
            selectedProvider,
            selectedModel,
            vectorProvider,
            vectorModel,
            vectorFallbackReason: this.providerFallbackReason || null,
            transformers: getTransformersRuntimeStatus(transformerTargetModel),
        };
    }

    async indexFile(
        path: string,
        content: string,
        source: "memory" | "sessions" | "workspace" = "memory"
    ): Promise<number> {
        await this.ensureReady();

        if (!this.provider || this.provider.id === "none") {
            return 0;
        }

        const oldChunks = Array.from(this.chunks.values()).filter((chunk) => chunk.path === path);
        for (const chunk of oldChunks) {
            this.chunks.delete(chunk.id);
            this.db.run("DELETE FROM chunks WHERE id = ?", [chunk.id]);
        }

        const textChunks = chunkMarkdown(content);
        if (textChunks.length === 0) return 0;

        const embeddings = await this.provider.embedBatch(textChunks.map((chunk) => chunk.text));
        const now = Date.now();
        const stmt = this.db.prepare(
            "INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, content, embedding, source, created_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );

        let insertedCount = 0;
        for (let i = 0; i < textChunks.length; i += 1) {
            const chunk = textChunks[i];
            const embedding = embeddings[i];
            if (!embedding || embedding.length === 0) continue;

            const hash = hashContent(chunk.text);
            const id = `${path}:${chunk.startLine}:${hash}`;
            const memoryChunk: MemoryChunk = {
                id,
                path,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.text,
                embedding,
                source,
                createdAt: now,
                hash,
            };

            this.chunks.set(id, memoryChunk);
            stmt.run(
                id,
                path,
                chunk.startLine,
                chunk.endLine,
                chunk.text,
                JSON.stringify(embedding),
                source,
                now,
                hash
            );
            insertedCount += 1;
        }

        console.log(`[VectorStore] Indexed ${insertedCount} chunks for ${path}`);
        return insertedCount;
    }

    async search(
        query: string,
        options: {
            maxResults?: number;
            minScore?: number;
            source?: "memory" | "sessions" | "workspace";
        } = {}
    ): Promise<VectorSearchResult[]> {
        await this.ensureReady();

        const maxResults = options.maxResults ?? 10;
        const minScore = options.minScore ?? 0.3;

        if (!this.provider || this.provider.id === "none") {
            return this.keywordSearch(query, maxResults);
        }

        const queryEmbedding = await this.provider.embedQuery(query);
        if (queryEmbedding.length === 0) {
            return this.keywordSearch(query, maxResults);
        }

        let candidates = Array.from(this.chunks.values());
        if (options.source) {
            candidates = candidates.filter((chunk) => chunk.source === options.source);
        }

        const similar = findTopKSimilar(
            queryEmbedding,
            candidates.map((chunk) => ({
                id: chunk.id,
                embedding: chunk.embedding,
            })),
            maxResults * 2
        );

        const vectorResults = similar
            .filter((result) => result.score >= minScore)
            .map((result) => {
                const chunk = this.chunks.get(result.id);
                if (!chunk) return null;
                return {
                    id: result.id,
                    path: chunk.path,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    content: chunk.content.slice(0, 500),
                    score: result.score,
                    source: chunk.source,
                } as VectorSearchResult;
            })
            .filter((result): result is VectorSearchResult => Boolean(result));

        const keywordResults = this.keywordSearch(query, maxResults);
        const merged = this.mergeResults(vectorResults, keywordResults, 0.7, 0.3);
        return merged.slice(0, maxResults);
    }

    private keywordSearch(query: string, maxResults: number): VectorSearchResult[] {
        const terms = this.tokenize(query);
        if (terms.length === 0) return [];

        const chunks = Array.from(this.chunks.values());
        if (chunks.length === 0) return [];

        const k1 = 1.5;
        const b = 0.75;
        const avgDl = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length;

        const idf = new Map<string, number>();
        for (const term of terms) {
            const docsWithTerm = chunks.filter((chunk) => chunk.content.toLowerCase().includes(term)).length;
            const idfScore = Math.log((chunks.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
            idf.set(term, Math.max(0, idfScore));
        }

        const scored: Array<VectorSearchResult & { bm25Score: number }> = [];
        for (const chunk of chunks) {
            const contentLower = chunk.content.toLowerCase();
            const dl = chunk.content.length;
            let score = 0;

            for (const term of terms) {
                const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
                const matches = contentLower.match(regex);
                const tf = matches ? matches.length : 0;
                if (tf === 0) continue;

                const termIdf = idf.get(term) || 0;
                const numerator = tf * (k1 + 1);
                const denominator = tf + k1 * (1 - b + b * (dl / avgDl));
                score += termIdf * (numerator / denominator);
            }

            if (score > 0) {
                scored.push({
                    id: chunk.id,
                    path: chunk.path,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    content: chunk.content.slice(0, 500),
                    score,
                    source: chunk.source,
                    bm25Score: score,
                });
            }
        }

        const maxScore = Math.max(...scored.map((result) => result.score), 1);
        for (const result of scored) {
            result.score = result.score / maxScore;
        }

        return scored
            .sort((left, right) => right.score - left.score)
            .slice(0, maxResults);
    }

    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .split(/[\s\-_.,;:!?()[\]{}'"<>]+/)
            .filter((token) => token.length > 2)
            .filter((token, index, values) => values.indexOf(token) === index);
    }

    private mergeResults(
        vectorResults: VectorSearchResult[],
        keywordResults: VectorSearchResult[],
        vectorWeight: number,
        keywordWeight: number
    ): VectorSearchResult[] {
        const byId = new Map<string, { vector: number; keyword: number; result: VectorSearchResult }>();

        for (const result of vectorResults) {
            byId.set(result.id, { vector: result.score, keyword: 0, result });
        }

        for (const result of keywordResults) {
            const existing = byId.get(result.id);
            if (existing) {
                existing.keyword = result.score;
            } else {
                byId.set(result.id, { vector: 0, keyword: result.score, result });
            }
        }

        return Array.from(byId.values())
            .map(({ vector, keyword, result }) => ({
                ...result,
                score: vector * vectorWeight + keyword * keywordWeight,
            }))
            .sort((left, right) => right.score - left.score);
    }

    removeFile(path: string): number {
        const oldChunks = Array.from(this.chunks.values()).filter((chunk) => chunk.path === path);
        for (const chunk of oldChunks) {
            this.chunks.delete(chunk.id);
        }
        const result = this.db.run("DELETE FROM chunks WHERE path = ?", [path]);
        return result.changes;
    }

    removeBySource(source: "memory" | "sessions" | "workspace"): number {
        const oldChunks = Array.from(this.chunks.values()).filter((chunk) => chunk.source === source);
        for (const chunk of oldChunks) {
            this.chunks.delete(chunk.id);
        }
        const result = this.db.run("DELETE FROM chunks WHERE source = ?", [source]);
        return result.changes;
    }

    stats(): {
        chunks: number;
        files: number;
        provider: string;
        model: string;
        source: EmbeddingProviderId;
        fallbackReason?: string | null;
    } {
        const paths = new Set(Array.from(this.chunks.values()).map((chunk) => chunk.path));
        return {
            chunks: this.chunks.size,
            files: paths.size,
            provider: this.provider?.id ?? "none",
            model: this.provider?.model ?? "none",
            source: this.providerSource,
            fallbackReason: this.providerFallbackReason,
        };
    }

    close(): void {
        this.db.close();
    }
}

let vectorStoreInstance: VectorStore | null = null;

export function getVectorStore(): VectorStore {
    if (!vectorStoreInstance) {
        vectorStoreInstance = new VectorStore();
    }
    return vectorStoreInstance;
}
