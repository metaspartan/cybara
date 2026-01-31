// In-memory vector store for semantic memory search
// Persists to SQLite for durability

import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import {
    createEmbeddingProvider,
    cosineSimilarity,
    findTopKSimilar,
    type EmbeddingProvider,
} from "./embeddings";

const MEMORY_DIR = join(process.env.HOME || "~", ".cybara", "memory");
const VECTOR_DB_PATH = join(MEMORY_DIR, "vectors.db");

export interface MemoryChunk {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    embedding: number[];
    source: "memory" | "sessions";
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
    source: "memory" | "sessions";
}

// Simple hash for content deduplication
function hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

// Chunk markdown content into semantic units
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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTokens = estimateTokens(line);

        // Check if this is a section header
        const isHeader = /^#{1,6}\s/.test(line);

        // Start new chunk on headers or when max tokens exceeded
        if (isHeader && currentChunk.length > 0) {
            chunks.push({
                text: currentChunk.join("\n"),
                startLine: currentStartLine,
                endLine: i,
            });
            currentChunk = [line];
            currentStartLine = i + 1;
            currentTokens = lineTokens;
        } else if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
            chunks.push({
                text: currentChunk.join("\n"),
                startLine: currentStartLine,
                endLine: i,
            });
            currentChunk = [line];
            currentStartLine = i + 1;
            currentTokens = lineTokens;
        } else {
            currentChunk.push(line);
            currentTokens += lineTokens;
        }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
        chunks.push({
            text: currentChunk.join("\n"),
            startLine: currentStartLine,
            endLine: lines.length,
        });
    }

    return chunks.filter(c => c.text.trim().length > 10);
}

export class VectorStore {
    private db: Database;
    private provider: EmbeddingProvider | null = null;
    private providerReady: Promise<void>;
    private chunks: Map<string, MemoryChunk> = new Map();

    constructor() {
        // Ensure directory exists
        if (!existsSync(MEMORY_DIR)) {
            mkdirSync(MEMORY_DIR, { recursive: true });
        }

        this.db = new Database(VECTOR_DB_PATH);
        this.initSchema();
        this.loadChunks();

        // Initialize embedding provider asynchronously
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
        const rows = this.db.query(
            "SELECT id, path, start_line, end_line, content, embedding, source, created_at, hash FROM chunks"
        ).all() as Array<{
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
                    source: row.source as "memory" | "sessions",
                    createdAt: row.created_at,
                    hash: row.hash,
                });
            } catch {
                // Skip invalid entries
            }
        }

        console.log(`[VectorStore] Loaded ${this.chunks.size} chunks from database`);
    }

    private async initProvider(): Promise<void> {
        const result = await createEmbeddingProvider();
        this.provider = result.provider;

        if (result.source === "none") {
            console.warn("[VectorStore] No embedding provider available:", result.fallbackReason);
        } else {
            console.log(`[VectorStore] Using ${result.source} embeddings (${result.provider.model})`);
        }
    }

    async ensureReady(): Promise<void> {
        await this.providerReady;
    }

    /**
     * Add or update a memory file in the vector store
     */
    async indexFile(
        path: string,
        content: string,
        source: "memory" | "sessions" = "memory"
    ): Promise<number> {
        await this.ensureReady();

        if (!this.provider || this.provider.id === "none") {
            return 0;
        }

        // Remove old chunks for this path
        const oldChunks = Array.from(this.chunks.values()).filter(c => c.path === path);
        for (const chunk of oldChunks) {
            this.chunks.delete(chunk.id);
            this.db.run("DELETE FROM chunks WHERE id = ?", [chunk.id]);
        }

        // Chunk the content
        const textChunks = chunkMarkdown(content);
        if (textChunks.length === 0) return 0;

        // Generate embeddings
        const embeddings = await this.provider.embedBatch(textChunks.map(c => c.text));

        // Store chunks
        const now = Date.now();
        const stmt = this.db.prepare(
            "INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, content, embedding, source, created_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );

        for (let i = 0; i < textChunks.length; i++) {
            const chunk = textChunks[i];
            const embedding = embeddings[i];

            if (!embedding || embedding.length === 0) continue;

            const hash = hashContent(chunk.text);
            const id = `${path}:${chunk.startLine}:${hash}`;

            const memChunk: MemoryChunk = {
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

            this.chunks.set(id, memChunk);
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
        }

        console.log(`[VectorStore] Indexed ${textChunks.length} chunks for ${path}`);
        return textChunks.length;
    }

    /**
     * Search for similar content using vector similarity
     */
    async search(
        query: string,
        options: {
            maxResults?: number;
            minScore?: number;
            source?: "memory" | "sessions";
        } = {}
    ): Promise<VectorSearchResult[]> {
        await this.ensureReady();

        const maxResults = options.maxResults ?? 10;
        const minScore = options.minScore ?? 0.3;

        if (!this.provider || this.provider.id === "none") {
            // Fallback to keyword search
            return this.keywordSearch(query, maxResults);
        }

        // Get query embedding
        const queryEmbedding = await this.provider.embedQuery(query);
        if (queryEmbedding.length === 0) {
            return this.keywordSearch(query, maxResults);
        }

        // Filter candidates by source if specified
        let candidates = Array.from(this.chunks.values());
        if (options.source) {
            candidates = candidates.filter(c => c.source === options.source);
        }

        // Find similar chunks
        const similar = findTopKSimilar(
            queryEmbedding,
            candidates.map(c => ({ id: c.id, embedding: c.embedding })),
            maxResults * 2 // Get more for hybrid ranking
        );

        // Map to results
        const vectorResults = similar
            .filter(s => s.score >= minScore)
            .map(s => {
                const chunk = this.chunks.get(s.id)!;
                return {
                    id: s.id,
                    path: chunk.path,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    content: chunk.content.slice(0, 500),
                    score: s.score,
                    source: chunk.source,
                };
            });

        // Hybrid: also get keyword results and merge
        const keywordResults = this.keywordSearch(query, maxResults);
        const merged = this.mergeResults(vectorResults, keywordResults, 0.7, 0.3);

        return merged.slice(0, maxResults);
    }

    /**
     * Simple keyword search fallback
     */
    private keywordSearch(query: string, maxResults: number): VectorSearchResult[] {
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        if (terms.length === 0) return [];

        const scored: Array<VectorSearchResult & { keywordScore: number }> = [];

        for (const chunk of this.chunks.values()) {
            const contentLower = chunk.content.toLowerCase();
            let matches = 0;

            for (const term of terms) {
                if (contentLower.includes(term)) {
                    matches++;
                }
            }

            if (matches > 0) {
                const score = matches / terms.length;
                scored.push({
                    id: chunk.id,
                    path: chunk.path,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    content: chunk.content.slice(0, 500),
                    score,
                    source: chunk.source,
                    keywordScore: score,
                });
            }
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults);
    }

    /**
     * Merge vector and keyword results with weighted scores
     */
    private mergeResults(
        vectorResults: VectorSearchResult[],
        keywordResults: VectorSearchResult[],
        vectorWeight: number,
        keywordWeight: number
    ): VectorSearchResult[] {
        const byId = new Map<string, { vector: number; keyword: number; result: VectorSearchResult }>();

        for (const r of vectorResults) {
            byId.set(r.id, { vector: r.score, keyword: 0, result: r });
        }

        for (const r of keywordResults) {
            const existing = byId.get(r.id);
            if (existing) {
                existing.keyword = r.score;
            } else {
                byId.set(r.id, { vector: 0, keyword: r.score, result: r });
            }
        }

        return Array.from(byId.values())
            .map(({ vector, keyword, result }) => ({
                ...result,
                score: vector * vectorWeight + keyword * keywordWeight,
            }))
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Remove a file from the index
     */
    removeFile(path: string): number {
        const oldChunks = Array.from(this.chunks.values()).filter(c => c.path === path);
        for (const chunk of oldChunks) {
            this.chunks.delete(chunk.id);
        }

        const result = this.db.run("DELETE FROM chunks WHERE path = ?", [path]);
        return result.changes;
    }

    /**
     * Get store statistics
     */
    stats(): {
        chunks: number;
        files: number;
        provider: string;
        model: string;
    } {
        const paths = new Set(Array.from(this.chunks.values()).map(c => c.path));
        return {
            chunks: this.chunks.size,
            files: paths.size,
            provider: this.provider?.id ?? "none",
            model: this.provider?.model ?? "none",
        };
    }

    close(): void {
        this.db.close();
    }
}

// Singleton instance
let vectorStoreInstance: VectorStore | null = null;

export function getVectorStore(): VectorStore {
    if (!vectorStoreInstance) {
        vectorStoreInstance = new VectorStore();
    }
    return vectorStoreInstance;
}
