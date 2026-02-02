// Memory module exports
export {
    type EmbeddingProvider,
    type EmbeddingProviderResult,
    createEmbeddingProvider,
    cosineSimilarity,
    findTopKSimilar,
} from "./embeddings";

export {
    type MemoryChunk,
    type VectorSearchResult,
    VectorStore,
    getVectorStore,
    chunkMarkdown,
} from "./vector-store";

export {
    type MemoryFlushSettings,
    resolveMemoryFlushSettings,
    shouldRunMemoryFlush,
    estimateTokens,
    estimateMessagesTokens,
    getDefaultContextWindow,
    DEFAULT_MEMORY_FLUSH_PROMPT,
    DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT,
    DEFAULT_MEMORY_FLUSH_SOFT_TOKENS,
} from "./flush";

