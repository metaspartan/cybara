import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, RefreshCw, Search, Loader2, Clock, Folder, HardDrive } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { chatApi } from "@/lib/api";

interface ArtifactSummary {
  sessionId: string;
  name: string;
  fileName: string;
  path: string;
  kind: "task" | "implementation" | "walkthrough" | "notes" | "custom";
  title: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return timestamp;
  return new Date(parsed).toLocaleString();
}

export function Artifacts() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ArtifactSummary | null>(null);
  const [rawView, setRawView] = useState(false);

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", "all"],
    queryFn: async () => {
      const response = await chatApi.listArtifacts();
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load artifacts");
      }
      return response.data.artifacts as ArtifactSummary[];
    },
    refetchInterval: 15000,
  });

  const artifacts = artifactsQuery.data || [];
  const filteredArtifacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...artifacts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!query) return sorted;
    return sorted.filter((artifact) => {
      return (
        artifact.fileName.toLowerCase().includes(query) ||
        artifact.title.toLowerCase().includes(query) ||
        artifact.sessionId.toLowerCase().includes(query) ||
        artifact.kind.toLowerCase().includes(query)
      );
    });
  }, [artifacts, search]);

  useEffect(() => {
    if (filteredArtifacts.length === 0) {
      if (selected) setSelected(null);
      return;
    }
    if (!selected) {
      setSelected(filteredArtifacts[0]);
      return;
    }
    const stillExists = filteredArtifacts.some(
      (artifact) =>
        artifact.sessionId === selected.sessionId && artifact.fileName === selected.fileName
    );
    if (!stillExists) {
      setSelected(filteredArtifacts[0]);
    }
  }, [filteredArtifacts, selected]);

  const artifactContentQuery = useQuery({
    queryKey: ["artifacts", "content", selected?.sessionId, selected?.fileName],
    enabled: !!selected,
    queryFn: async () => {
      if (!selected) return null;
      const response = await chatApi.readSessionArtifact(selected.sessionId, selected.fileName);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load artifact content");
      }
      return response.data;
    },
  });

  return (
    <PageLayout title="Artifacts" subtitle="Browse all session artifacts and inspect their content">
      <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-6 min-h-[70vh]">
        <Card className="flex flex-col min-h-[70vh]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-300" />
              Artifact Library
            </CardTitle>
            <CardDescription>
              {filteredArtifacts.length} of {artifacts.length} artifacts
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search artifacts..."
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 !outline-none focus:border-white/20"
                />
              </div>
              <button
                type="button"
                onClick={() => artifactsQuery.refetch()}
                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-2 text-gray-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                title="Refresh artifacts"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {artifactsQuery.isLoading ? (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading artifacts...
              </div>
            ) : filteredArtifacts.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center text-gray-500">
                <div>
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No artifacts found</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                {filteredArtifacts.map((artifact) => {
                  const isSelected =
                    selected?.sessionId === artifact.sessionId &&
                    selected?.fileName === artifact.fileName;
                  return (
                    <button
                      type="button"
                      key={`${artifact.sessionId}:${artifact.fileName}`}
                      onClick={() => {
                        setSelected(artifact);
                        setRawView(false);
                      }}
                      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${isSelected
                          ? "border-indigo-500/40 bg-indigo-500/15"
                          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]"
                        }`}
                    >
                      <p className="text-sm text-white truncate">{artifact.title || artifact.fileName}</p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{artifact.fileName}</p>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Folder className="w-3 h-3" />
                          {artifact.sessionId.slice(0, 12)}...
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <HardDrive className="w-3 h-3" />
                          {formatBytes(artifact.size)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col min-h-[70vh]">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 min-w-0">
                <FileText className="w-5 h-5 text-cyan-300" />
                <span className="truncate">{selected?.fileName || "Artifact Preview"}</span>
              </CardTitle>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRawView(false)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer ${!rawView
                      ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-200"
                      : "border-white/15 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/[0.08]"
                    }`}
                >
                  Markdown
                </button>
                <button
                  type="button"
                  onClick={() => setRawView(true)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer ${rawView
                      ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-200"
                      : "border-white/15 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/[0.08]"
                    }`}
                >
                  Raw
                </button>
              </div>
            </div>
            {selected && (
              <CardDescription>
                <span className="inline-flex items-center gap-1 mr-3">
                  <Clock className="w-3 h-3" />
                  Updated {formatDate(selected.updatedAt)}
                </span>
                <span>{selected.path}</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                Select an artifact to preview it.
              </div>
            ) : artifactContentQuery.isLoading ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading artifact...
              </div>
            ) : artifactContentQuery.isError ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {artifactContentQuery.error instanceof Error
                  ? artifactContentQuery.error.message
                  : "Failed to load artifact"}
              </div>
            ) : rawView ? (
              <pre className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-gray-200 whitespace-pre-wrap">
                {artifactContentQuery.data?.content || ""}
              </pre>
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <div className="max-w-none text-sm text-gray-200 leading-6">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {artifactContentQuery.data?.content || ""}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

export default Artifacts;
