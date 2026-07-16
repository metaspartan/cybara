export type TransformersEmbeddingWorkerRequest =
  | { id: string; action: "ping" }
  | {
      id: string;
      action: "embed";
      model: string;
      texts: string[];
      dtype: string;
      device: string;
    }
  | { id: string; action: "unload"; model: string };

export type TransformersEmbeddingWorkerResponse =
  | { id: string; type: "progress"; progress: number; status: string | null }
  | { id: string; type: "result"; success: true; embeddings?: number[][] }
  | { id: string; type: "result"; success: false; error: string };

export function isTransformersEmbeddingWorkerResponse(
  value: unknown
): value is TransformersEmbeddingWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && (record.type === "progress" || record.type === "result");
}
