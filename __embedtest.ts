import { createEmbeddingProvider } from "./src/core/memory/embeddings";
const models = ["Xenova/bge-base-en-v1.5","mixedbread-ai/mxbai-embed-large-v1","nomic-ai/nomic-embed-text-v1.5"];
(async () => {
  for (const model of models) {
    try {
      const res: any = await createEmbeddingProvider({ provider: "transformers_js", model });
      if (!res.provider) { console.log(`❌ ${model}: no provider (${res.fallbackReason||res.source})`); continue; }
      const vec = await res.provider.embedQuery("test");
      console.log(`✅ ${model}: dims=${Array.isArray(vec)?vec.length:typeof vec}`);
    } catch (e) {
      console.log(`❌ ${model}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
})();
