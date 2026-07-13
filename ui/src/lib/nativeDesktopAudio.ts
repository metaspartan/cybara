import { invoke } from "@tauri-apps/api/core";

export interface NativeRecordingPayload {
  audioBase64: string;
  mimeType: string;
  fileName: string;
}

export function nativeAudioErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error && typeof error === "object") {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") return serialized;
  }
  return fallback;
}

export async function startNativeAudioRecording(): Promise<void> {
  await invoke("start_native_recording");
}

export async function stopNativeAudioRecording(): Promise<NativeRecordingPayload> {
  return invoke<NativeRecordingPayload>("stop_native_recording");
}

export function nativeRecordingBlob(payload: NativeRecordingPayload): Blob {
  const binary = atob(payload.audioBase64);
  const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
  return new Blob([bytes], { type: payload.mimeType });
}
