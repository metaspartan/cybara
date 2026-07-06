import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Trash2,
  Edit2,
  Search,
  Plus,
  FileText,
  Save,
  X,
  ChevronRight,
  FolderOpen,
  Database,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Textarea } from "../components/ui/Input";
import { PageLayout } from "@/components/layout";
import { memoryApi } from "@/lib/api";
import { useMemory, useSearchMemory, useDeleteMemory, useUpdateMemory } from "../hooks/useApi";
import { useUIStore } from "../stores/uiStore";
import type { MemoryEntry } from "../types";

function formatMemoryDate(entry: MemoryEntry): string {
  if (entry.date && entry.timestamp) {
    const [hours, minutes, seconds] = entry.timestamp.split(":").map(Number);
    const [year, month, day] = entry.date.split("-").map(Number);

    const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  }
  return entry.timestamp || "Unknown";
}

type MemorySearchResult = {
  file: string;
  entry: MemoryEntry;
};

export function Memory() {
  const [searchQuery, setSearchQuery] = useState("");
  const [memStatus, setMemStatus] = useState<{
    provider?: string;
    model?: string;
    chunks?: number;
    files?: number;
    fallbackReason?: string | null;
  } | null>(null);

  const refreshStatus = useCallback(async () => {
    const res = await memoryApi.status();
    if (res?.success && res.data?.success) {
      setMemStatus({
        provider: res.data.provider,
        model: res.data.model,
        chunks: res.data.chunks,
        files: res.data.files,
        fallbackReason: res.data.fallbackReason,
      });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshStatus();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<{ file: string; entry: MemoryEntry } | null>(
    null
  );
  const [deletingEntry, setDeletingEntry] = useState<{ file: string; index: number } | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const { data: memoryData, isLoading, refetch: refetchMemory } = useMemory();
  const { data: searchResults } = useSearchMemory(searchQuery);
  const { addToast } = useUIStore();

  const deleteMemory = useDeleteMemory();
  const updateMemory = useUpdateMemory();

  const memory = Array.isArray(memoryData) ? memoryData : [];
  const memorySearchResults = Array.isArray(searchResults)
    ? (searchResults as MemorySearchResult[])
    : [];

  useEffect(() => {
    if (isLoading) return;
    if (!selectedFile && memory.length > 0) {
      setSelectedFile(memory[0].file);
      return;
    }
    if (selectedFile && !memory.some((mem) => mem.file === selectedFile)) {
      setSelectedFile(memory[0]?.file ?? null);
    }
  }, [isLoading, memory, selectedFile]);

  const handleUpdate = async (file: string, index: number, content: string) => {
    try {
      await updateMemory.mutateAsync({ file, index, content });
      addToast("success", "Memory entry updated");
      setEditingEntry(null);
      await refetchMemory();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update memory");
    }
  };

  const handleDelete = async () => {
    if (!deletingEntry) return;
    try {
      await deleteMemory.mutateAsync({
        file: deletingEntry.file,
        index: deletingEntry.index,
      });
      addToast("success", "Memory entry deleted");
      setDeletingEntry(null);
      await refetchMemory();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete memory");
    }
  };

  const handleCreate = async (formData: FormData) => {
    const file = formData.get("file") as string;
    const content = formData.get("content") as string;

    try {
      const result = await memoryApi.createFile(file, content);
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Failed to create memory");
      }

      addToast("success", result.data.appended ? "Memory entry added" : "Memory file created");
      setSelectedFile(result.data.file);
      setIsCreating(false);
      await refetchMemory();
      await refreshStatus();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to create memory");
    }
  };

  const selectedMemory = memory?.find((m) => m.file === selectedFile);
  const semanticSearchActive =
    memStatus?.provider && memStatus.provider !== "none" && memStatus.provider !== "local";
  const searchModeLabel = semanticSearchActive
    ? "Semantic + keyword"
    : memStatus?.provider === "local"
      ? "Keyword (local, no model)"
      : "Keyword";
  const searchModeDetail = semanticSearchActive
    ? `${memStatus?.provider === "transformers_js" ? "Transformers.js" : memStatus?.provider} · ${memStatus?.model}`
    : "No embedding model needed";
  const memoryStatusPanel = (
    <Card className="mb-6" variant="liquid">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-300" />
              Memory Store
            </CardTitle>
            <CardDescription>
              Memories always live on this machine as markdown files plus a local SQLite search
              index. Configure how they are searched in Settings &gt; AI &amp; Memory.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {memStatus && (
              <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-400">
                {searchModeLabel} · {memStatus.chunks ?? 0} chunks indexed
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-xs text-gray-500">Storage</p>
            <p className="mt-1 text-gray-200">Local database</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Markdown files + SQLite index</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-xs text-gray-500">Search</p>
            <p className="mt-1 text-gray-200">{searchModeLabel}</p>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={searchModeDetail}>
              {searchModeDetail}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-xs text-gray-500">Indexed</p>
            <p className="mt-1 text-gray-200">{memStatus?.chunks ?? 0} chunks</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              across {memStatus?.files ?? 0} files
            </p>
          </div>
        </div>
        {memStatus?.fallbackReason && (
          <p className="mt-3 text-[11px] text-amber-300/80">
            Fallback active: {memStatus.fallbackReason}
          </p>
        )}
      </CardContent>
    </Card>
  );

  if (!isLoading && memory.length === 0) {
    return (
      <PageLayout title="Memory">
        {memoryStatusPanel}
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="w-full max-w-lg" variant="liquid">
            <CardContent className="text-center py-12 px-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center mx-auto mb-6 border border-white/10">
                <FolderOpen className="w-10 h-10 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">No Memory Files</h3>
              <p className="text-gray-400 mb-6">
                Memory files store important information that agents can recall across
                conversations. Create your first memory file to get started.
              </p>
              <Button onClick={() => setIsCreating(true)}>Create Memory File</Button>
            </CardContent>
          </Card>
        </div>

        <Modal
          isOpen={isCreating}
          onClose={() => setIsCreating(false)}
          title="Create Memory File"
          size="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleCreate(formData);
            }}
            className="space-y-4"
          >
            <Input
              name="file"
              label="File Name"
              placeholder="e.g., preferences, project-notes"
              required
            />
            <Textarea
              name="content"
              label="Initial Content"
              placeholder="Enter initial memory content..."
              rows={6}
              required
            />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit">Create File</Button>
            </div>
          </form>
        </Modal>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Memory"
      actions={
        <Button onClick={() => setIsCreating(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Entry
        </Button>
      }
    >
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <Input
            placeholder="Search memory (semantic)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {memoryStatusPanel}

      {searchQuery && memorySearchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Search Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {memorySearchResults.map(({ file, entry }, idx) => (
                <div
                  key={`${file}:${entry.index ?? idx}`}
                  className="p-3 rounded-lg bg-white/5 border border-white/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-indigo-300 mb-1 truncate">{file}</p>
                      <p className="text-sm text-gray-300 whitespace-pre-wrap">{entry.content}</p>
                      <p className="text-xs text-gray-500 mt-1">{formatMemoryDate(entry)}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedFile(file);
                          setEditingEntry({ file, entry });
                        }}
                        aria-label={`Edit memory entry in ${file}`}
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingEntry({ file, index: entry.index ?? 0 })}
                        aria-label={`Delete memory entry in ${file}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="h-32 animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-white/10 rounded w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Memory Files
            </h3>
            {memory?.map((mem) => (
              <button
                key={mem.file}
                onClick={() => setSelectedFile(mem.file === selectedFile ? null : mem.file)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                  selectedFile === mem.file
                    ? "bg-indigo-500/20 border border-indigo-500/30"
                    : "bg-white/5 border border-transparent hover:bg-white/10"
                }`}
              >
                <FileText
                  className={`w-5 h-5 ${
                    selectedFile === mem.file ? "text-indigo-400" : "text-gray-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      selectedFile === mem.file ? "text-white" : "text-gray-300"
                    }`}
                  >
                    {mem.file}
                  </p>
                  <p className="text-xs text-gray-500">{mem.entries.length} entries</p>
                </div>
                <ChevronRight
                  className={`w-4 h-4 transition-transform ${
                    selectedFile === mem.file ? "rotate-90 text-indigo-400" : "text-gray-600"
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selectedMemory ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{selectedMemory.file}</CardTitle>
                      <CardDescription>{selectedMemory.entries.length} entries</CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto">
                    {selectedMemory.entries.map((entry) => (
                      <div
                        key={entry.index}
                        className="p-4 rounded-xl bg-white/5 border border-white/10"
                      >
                        {editingEntry?.file === selectedMemory.file &&
                        editingEntry?.entry.index === entry.index ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const formData = new FormData(e.currentTarget);
                              handleUpdate(
                                selectedMemory.file,
                                entry.index,
                                formData.get("content") as string
                              );
                            }}
                            className="space-y-3"
                          >
                            <Textarea
                              name="content"
                              defaultValue={entry.content}
                              rows={4}
                              autoFocus
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingEntry(null)}
                              >
                                Cancel
                              </Button>
                              <Button type="submit" size="sm" isLoading={updateMemory.isPending}>
                                <Save className="w-3 h-3 mr-1" />
                                Save
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <p className="text-gray-300 whitespace-pre-wrap">{entry.content}</p>
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                              <span className="text-xs text-gray-500">
                                {formatMemoryDate(entry)}
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setEditingEntry({ file: selectedMemory.file, entry })
                                  }
                                  aria-label={`Edit memory entry ${entry.index + 1}`}
                                >
                                  <Edit2 className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setDeletingEntry({
                                      file: selectedMemory.file,
                                      index: entry.index,
                                    })
                                  }
                                  aria-label={`Delete memory entry ${entry.index + 1}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full min-h-[400px] flex items-center justify-center">
                <CardContent className="text-center">
                  <Brain className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">Select a memory file</h3>
                  <p className="text-gray-400">
                    Choose a file from the list to view and edit entries
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <Modal
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        title="New Memory Entry"
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <Select
            name="file"
            label="Memory File"
            options={memory?.map((m) => ({ value: m.file, label: m.file })) || []}
            required
          />
          <Textarea
            name="content"
            label="Content"
            placeholder="Enter memory content..."
            rows={6}
            required
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Entry</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deletingEntry}
        onClose={() => setDeletingEntry(null)}
        onConfirm={handleDelete}
        title="Delete Memory Entry"
        description="Are you sure you want to delete this memory entry? This action cannot be undone."
        confirmText="Delete"
        isLoading={deleteMemory.isPending}
        variant="danger"
      />
    </PageLayout>
  );
}

export default Memory;
