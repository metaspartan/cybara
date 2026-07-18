import { useCallback, useState } from "react";
import { chatApi } from "@/lib/api";
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
      const response = await chatApi.readSessionArtifact(artifact.sessionId, artifact.fileName);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load artifact");
      }
      if (typeof response.data.content !== "string") {
        throw new Error("Artifact response did not include content");
      }

      setTarget((previous) => ({
        ...(previous ?? artifact),
        path:
          typeof response.data?.artifact.path === "string"
            ? response.data.artifact.path
            : previous?.path,
      }));
      setContent(response.data.content);
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
