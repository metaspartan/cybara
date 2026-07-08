import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import type { GitBranchOption } from "./GitBranchSelector";

interface GitBranchesResponse {
  success?: boolean;
  current?: unknown;
  branches?: unknown;
  error?: unknown;
}

interface GitBranchMutationResponse {
  success?: boolean;
  branch?: unknown;
  error?: unknown;
}

function normalizeGitBranches(value: unknown): GitBranchOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) return null;
      const branch: GitBranchOption = { name, current: record.current === true };
      return branch;
    })
    .filter((item): item is GitBranchOption => item !== null);
}

function responseError(data: GitBranchesResponse | GitBranchMutationResponse, fallback: string) {
  return typeof data.error === "string" && data.error.trim() ? data.error.trim() : fallback;
}

export function useEnvironmentGitBranches(workspaceDir: string | null) {
  const [branches, setBranches] = useState<GitBranchOption[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [changingBranch, setChangingBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const workspace = workspaceDir?.trim();
    if (!workspace) {
      setBranches([]);
      setCurrentBranch(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const response = await apiFetch(`/api/git/branches?path=${encodeURIComponent(workspace)}`);
      const data = (await response.json().catch(() => ({}))) as GitBranchesResponse;
      if (!response.ok || data.success === false) {
        throw new Error(responseError(data, "Failed to load git branches"));
      }
      const nextBranches = normalizeGitBranches(data.branches);
      const current = typeof data.current === "string" ? data.current.trim() : "";
      setBranches(nextBranches);
      setCurrentBranch(current || nextBranches.find((branch) => branch.current)?.name || null);
      setError(null);
    } catch (caught) {
      setBranches([]);
      setCurrentBranch(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [workspaceDir]);

  const checkout = useCallback(
    async (branch: string, create = false) => {
      const workspace = workspaceDir?.trim();
      const nextBranch = branch.trim();
      if (!workspace || !nextBranch) return;
      setChangingBranch(nextBranch);
      setError(null);
      try {
        const response = await apiFetch("/api/git/branch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: workspace, branch: nextBranch, create }),
        });
        const data = (await response.json().catch(() => ({}))) as GitBranchMutationResponse;
        if (!response.ok || data.success === false) {
          throw new Error(responseError(data, `Failed to switch to ${nextBranch}`));
        }
        const current = typeof data.branch === "string" ? data.branch.trim() : nextBranch;
        setCurrentBranch(current || nextBranch);
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setChangingBranch(null);
      }
    },
    [refresh, workspaceDir]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    branches,
    changingBranch,
    checkout,
    createAndCheckout: (branch: string) => checkout(branch, true),
    currentBranch,
    error,
    loading,
    refresh,
  };
}
