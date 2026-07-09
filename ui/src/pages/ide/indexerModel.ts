import type {
  WorkspaceEmbeddingRuntimeModelStatus,
  WorkspaceEmbeddingRuntimeResponse,
  WorkspaceIndexerSettings,
} from "./ideTypes";

export interface EmbeddingRuntimeSelection {
  provider: string;
  model: string;
}

// Resolve the provider/model the runtime should report on, honoring an explicit
// selection and falling back to whatever the runtime is actually using.
export function resolveEmbeddingRuntimeSelection(
  settings: WorkspaceIndexerSettings,
  runtime: WorkspaceEmbeddingRuntimeResponse | null
): EmbeddingRuntimeSelection {
  const explicitProvider = settings.embeddingProvider;
  const provider =
    explicitProvider === "auto"
      ? runtime?.vectorProvider === "transformers_js" || runtime?.vectorProvider === "ollama"
        ? runtime.vectorProvider
        : "transformers_js"
      : explicitProvider;
  const model =
    settings.embeddingModel ||
    (provider === "transformers_js"
      ? runtime?.transformers?.selectedModel || ""
      : runtime?.vectorModel || "");
  return { provider, model };
}

export type RuntimeModelTone = "loaded" | "loading" | "error" | "idle";

export interface RuntimeModelStatus {
  label: string;
  tone: RuntimeModelTone;
}

// Human-readable "is the model loaded?" status for the settings UI.
export function computeRuntimeModelStatus(
  runtimeTargetProvider: string,
  runtime: WorkspaceEmbeddingRuntimeResponse | null,
  entry: WorkspaceEmbeddingRuntimeModelStatus | null
): RuntimeModelStatus {
  if (runtimeTargetProvider === "transformers_js") {
    const state = runtime?.transformers?.selectedState;
    if (state === "ready") return { label: "Loaded", tone: "loaded" };
    if (state === "loading") {
      const pct = typeof entry?.loadProgress === "number" ? ` ${entry.loadProgress}%` : "…";
      return { label: `Loading${pct}`, tone: "loading" };
    }
    if (state === "error") return { label: "Load failed", tone: "error" };
    return {
      label: entry?.estimatedModelBytes ? "Not loaded · cached" : "Not loaded",
      tone: "idle",
    };
  }
  if (runtimeTargetProvider === "ollama") {
    return runtime?.vectorProvider === "ollama"
      ? { label: "Ready via Ollama", tone: "loaded" }
      : { label: "Ollama unavailable", tone: "idle" };
  }
  return { label: "Managed by provider", tone: "idle" };
}
