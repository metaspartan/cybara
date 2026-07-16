import { useCallback, useState } from "react";
import { appendApiTokenParam } from "@/lib/auth";
import type { ArtifactSummaryView } from "./chatModel";

interface ArtifactViewerState {
  closeArtifactViewer: () => void;
  content: string;
  error: string | null;
  loading: boolean;
  openArtifactViewer: (artifact: ArtifactSummaryView) => Promise<void>;
  rawView: boolean;
  setRawView: React.Dispatch<React.SetStateAction<boolean>>;
  target: ArtifactSummaryView | null;
}

interface ArtifactResponse {
  artifact?: { path?: string };
  content?: string;
  error?: string;
}

export function useArtifactViewer(): ArtifactViewerState {
  const [target, setTarget] = useState<ArtifactSummaryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [rawView, setRawView] = useState(false);

  const openArtifactViewer = useCallback(async (artifact: ArtifactSummaryView): Promise<void> => {
    setTarget(artifact);
    setLoading(true);
    setError(null);
    setContent("");
    setRawView(false);

    try {
      const url = appendApiTokenParam(
        `/api/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.fileName)}`
      );
      const response = await fetch(url);
      const payload = (await response.json()) as ArtifactResponse;

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to load artifact (${response.status})`
        );
      }
      if (typeof payload.content !== "string") {
        throw new Error("Artifact response did not include content");
      }

      setTarget((previous) => ({
        ...(previous ?? artifact),
        path: typeof payload.artifact?.path === "string" ? payload.artifact.path : previous?.path,
      }));
      setContent(payload.content);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load artifact");
      setContent("");
    } finally {
      setLoading(false);
    }
  }, []);

  const closeArtifactViewer = useCallback((): void => {
    setTarget(null);
    setLoading(false);
    setError(null);
    setContent("");
    setRawView(false);
  }, []);

  return {
    closeArtifactViewer,
    content,
    error,
    loading,
    openArtifactViewer,
    rawView,
    setRawView,
    target,
  };
}
