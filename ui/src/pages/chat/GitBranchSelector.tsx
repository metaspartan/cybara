import { Check, ChevronDown, GitBranch, Loader2, Plus, Search } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface GitBranchOption {
  name: string;
  current?: boolean;
}

export function GitBranchSelector({
  branches,
  changingBranch,
  currentBranch,
  disabled = false,
  error,
  loading,
  appearance = "control",
  onCheckout,
  onCreate,
  onRefresh,
}: {
  branches: GitBranchOption[];
  changingBranch?: string | null;
  currentBranch: string | null;
  disabled?: boolean;
  error?: string | null;
  loading?: boolean;
  appearance?: "control" | "inline";
  onCheckout: (branch: string) => Promise<void> | void;
  onCreate: (branch: string) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const activeChangingBranch = changingBranch ?? null;
  const filteredBranches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return branches;
    return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
  }, [branches, query]);
  const selectedBranch = currentBranch || (loading ? "Loading..." : "No branch");
  const canCreate =
    newBranch.trim().length > 0 && !branches.some((b) => b.name === newBranch.trim());

  const handleCheckout = async (branch: string) => {
    await onCheckout(branch);
    setOpen(false);
  };

  const handleCreate = async () => {
    const branch = newBranch.trim();
    if (!branch) return;
    await onCreate(branch);
    setNewBranch("");
    setQuery("");
    setOpen(false);
  };

  return (
    <div
      className={cn(
        "relative flex min-w-0",
        appearance === "inline" ? "justify-start" : "ml-auto justify-end"
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void onRefresh();
        }}
        className={cn(
          "inline-flex max-w-[180px] items-center gap-1.5 text-[12px] leading-4 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]",
          appearance === "inline"
            ? "rounded-md border-0 bg-transparent px-1.5 py-1 hover:bg-[var(--surface-hover)]"
            : "rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1 hover:bg-[var(--surface-hover)]",
          disabled && "cursor-not-allowed opacity-60"
        )}
        title="Change git branch"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
        )}
        <span className="truncate">{selectedBranch}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
      </button>

      {open && (
        <div className="theme-tooltip-panel absolute right-0 top-8 z-[2147483001] w-[286px] rounded-xl border p-2 text-left">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--form-control-border)] bg-[var(--form-control-bg)] px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-[var(--icon-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branches"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--form-control-placeholder)] focus:ring-0"
            />
          </div>

          <div className="mt-2 text-[11px] text-[var(--text-muted)]">Branches</div>
          <div className="mt-1 max-h-48 overflow-y-auto">
            {filteredBranches.length > 0 ? (
              filteredBranches.map((branch) => (
                <button
                  key={branch.name}
                  type="button"
                  disabled={activeChangingBranch !== null && activeChangingBranch !== branch.name}
                  onClick={() => void handleCheckout(branch.name)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
                >
                  {activeChangingBranch === branch.name ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--icon-muted)]" />
                  ) : (
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
                  {(branch.current || branch.name === currentBranch) && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[var(--text-primary)]" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-2 py-3 text-[12px] text-[var(--text-muted)]">
                No matching branches
              </div>
            )}
          </div>

          <div className="mt-2 border-t border-[var(--surface-border)] pt-2">
            <div className="flex items-center gap-2">
              <input
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                placeholder="New branch name"
                className="min-w-0 flex-1 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-backdrop)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--form-control-placeholder)] focus:ring-0"
              />
              <button
                type="button"
                disabled={!canCreate || activeChangingBranch !== null}
                onClick={() => void handleCreate()}
                className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                title="Create and checkout branch"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {error && <div className="mt-1.5 text-[11px] text-red-300">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
