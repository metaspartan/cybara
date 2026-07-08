import { Check, ChevronDown, GitBranch, Loader2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
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
  onCheckout: (branch: string) => Promise<void> | void;
  onCreate: (branch: string) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const activeChangingBranch = changingBranch ?? null;
  const filteredBranches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return branches;
    return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
  }, [branches, query]);
  const selectedBranch = currentBranch || "No branch";
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
    <div className="relative ml-auto flex min-w-0 justify-end">
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void onRefresh();
        }}
        className={cn(
          "inline-flex max-w-[180px] items-center gap-1.5 rounded-lg border border-[#2b303b] bg-[#12151d] px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-[#3d4350] hover:bg-[#171b24]",
          (disabled || loading) && "cursor-not-allowed opacity-60"
        )}
        title="Change git branch"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <GitBranch className="h-3 w-3 shrink-0 text-gray-500" />
        )}
        <span className="truncate font-mono">{selectedBranch}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-gray-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-[2147483001] w-[286px] rounded-xl border border-[#343843] bg-[#10131a] p-2 text-left shadow-[0_24px_70px_rgba(0,0,0,0.85)]">
          <div className="flex items-center gap-2 rounded-lg border border-[#2b303b] bg-[#0a0c11] px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-gray-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branches"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] text-gray-200 outline-none placeholder:text-gray-600 focus:ring-0"
            />
          </div>

          <div className="mt-2 text-[11px] text-gray-500">Branches</div>
          <div className="mt-1 max-h-48 overflow-y-auto">
            {filteredBranches.length > 0 ? (
              filteredBranches.map((branch) => (
                <button
                  key={branch.name}
                  type="button"
                  disabled={activeChangingBranch !== null && activeChangingBranch !== branch.name}
                  onClick={() => void handleCheckout(branch.name)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-gray-300 transition-colors hover:bg-[#1c202a] disabled:cursor-wait disabled:opacity-60"
                >
                  {activeChangingBranch === branch.name ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-500" />
                  ) : (
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
                  {(branch.current || branch.name === currentBranch) && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-2 py-3 text-[12px] text-gray-500">No matching branches</div>
            )}
          </div>

          <div className="mt-2 border-t border-[#2b303b] pt-2">
            <div className="flex items-center gap-2">
              <input
                value={newBranch}
                onChange={(event) => setNewBranch(event.target.value)}
                placeholder="New branch name"
                className="min-w-0 flex-1 rounded-lg border border-[#2b303b] bg-[#0a0c11] px-2 py-1.5 text-[12px] text-gray-200 outline-none placeholder:text-gray-600 focus:ring-0"
              />
              <button
                type="button"
                disabled={!canCreate || activeChangingBranch !== null}
                onClick={() => void handleCreate()}
                className="rounded-lg border border-[#343843] bg-[#171b24] p-1.5 text-gray-300 transition-colors hover:border-[#4a5060] hover:bg-[#202633] disabled:cursor-not-allowed disabled:opacity-50"
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
