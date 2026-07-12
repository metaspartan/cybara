export type LocalSpeechWorkerDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

interface LocalSpeechWorkerRequestBase {
  id: string;
  model: string;
  dtype: LocalSpeechWorkerDtype;
}

export type LocalSpeechWorkerRequest =
  | (LocalSpeechWorkerRequestBase & { action: "load" })
  | (LocalSpeechWorkerRequestBase & {
      action: "generate";
      text: string;
      voice: string;
      speed: number;
    })
  | (LocalSpeechWorkerRequestBase & { action: "unload" });

export type LocalSpeechWorkerResponse =
  | { id: string; type: "progress"; progress: number }
  | { id: string; type: "result"; success: true; wav?: Uint8Array }
  | { id: string; type: "result"; success: false; error: string };

export function isLocalSpeechWorkerResponse(value: unknown): value is LocalSpeechWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && (record.type === "progress" || record.type === "result");
}
