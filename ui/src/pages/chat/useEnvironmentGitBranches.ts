import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/auth";
import type { GitBranchOption } from "./GitBranchSelector";

interface GitBranchesResponse {
  success?: boolean;
  root?: unknown;
  current?: unknown;
  branches?: unknown;
  error?: unknown;
}

interface GitBranchMutationResponse {
  success?: boolean;
  root?: unknown;
  branch?: unknown;
  error?: unknown;
}

interface CachedGitBranches {
  branches: GitBranchOption[];
  currentBranch: string | null;
  root: string | null;
}

const branchCache = new Map<string, CachedGitBranches>();

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
  const [root, setRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [changingBranch, setChangingBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const workspace = workspaceDir?.trim();
    const requestId = ++requestIdRef.current;
    if (!workspace) {
      setBranches([]);
      setCurrentBranch(null);
      setRoot(null);
      setError(null);
      return;
    }
    const cached = branchCache.get(workspace);
    if (cached) {
      setBranches(cached.branches);
      setCurrentBranch(cached.currentBranch);
      setRoot(cached.root);
      setError(null);
    }
    setLoading(true);
    try {
      const response = await apiFetch(`/api/git/branches?path=${encodeURIComponent(workspace)}`);
      const data = (await response.json().catch(() => ({}))) as GitBranchesResponse;
      if (requestId !== requestIdRef.current) return;
      if (!response.ok || data.success === false) {
        throw new Error(responseError(data, "Failed to load git branches"));
      }
      const nextBranches = normalizeGitBranches(data.branches);
      const current = typeof data.current === "string" ? data.current.trim() : "";
      const nextRoot = typeof data.root === "string" && data.root.trim() ? data.root.trim() : null;
      const nextCurrent = current || nextBranches.find((branch) => branch.current)?.name || null;
      setBranches(nextBranches);
      setCurrentBranch(nextCurrent);
      setRoot(nextRoot);
      branchCache.set(workspace, {
        branches: nextBranches,
        currentBranch: nextCurrent,
        root: nextRoot,
      });
      setError(null);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      if (!cached) {
        setBranches([]);
        setCurrentBranch(null);
        setRoot(null);
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
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
        const nextRoot =
          typeof data.root === "string" && data.root.trim() ? data.root.trim() : root;
        const optimisticBranches = branches.some((item) => item.name === current)
          ? branches.map((item) => ({ ...item, current: item.name === current }))
          : [
              { name: current, current: true },
              ...branches.map((item) => ({ ...item, current: false })),
            ];
        setCurrentBranch(current || nextBranch);
        setRoot(nextRoot);
        branchCache.set(workspace, {
          branches: optimisticBranches,
          currentBranch: current || nextBranch,
          root: nextRoot,
        });
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setChangingBranch(null);
      }
    },
    [branches, refresh, root, workspaceDir]
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
    root,
  };
}
