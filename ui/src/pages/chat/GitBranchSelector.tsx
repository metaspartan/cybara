import { Check, ChevronDown, GitBranch, Loader2, Plus, Search } from "lucide-react";
import { type ReactElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const BRANCH_PANEL_WIDTH = 286;
const BRANCH_PANEL_MARGIN = 8;

export function branchPanelPosition(
  trigger: { top: number; bottom: number; right: number },
  panelHeight: number,
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const left = Math.max(
    BRANCH_PANEL_MARGIN,
    Math.min(
      trigger.right - BRANCH_PANEL_WIDTH,
      viewport.width - BRANCH_PANEL_WIDTH - BRANCH_PANEL_MARGIN
    )
  );
  const below = trigger.bottom + 4;
  if (below + panelHeight <= viewport.height - BRANCH_PANEL_MARGIN) return { left, top: below };
  const above = trigger.top - panelHeight - 4;
  if (above >= BRANCH_PANEL_MARGIN) return { left, top: above };
  return {
    left,
    top: Math.max(BRANCH_PANEL_MARGIN, viewport.height - panelHeight - BRANCH_PANEL_MARGIN),
  };
}

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
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

  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return;
    }
    const reposition = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const panelHeight = panelRef.current?.offsetHeight ?? 0;
      setPanelPosition(
        branchPanelPosition(trigger, panelHeight, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      );
    };
    reposition();
    const observer = panelRef.current ? new ResizeObserver(reposition) : null;
    if (observer && panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, panelPosition !== null]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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
        ref={triggerRef}
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

      {open && panelPosition
        ? createPortal(
            <div
              ref={panelRef}
              className="theme-tooltip-panel fixed z-[2147483001] w-[286px] rounded-xl border p-2 text-left"
              style={{ left: panelPosition.left, top: panelPosition.top }}
            >
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
                      disabled={
                        activeChangingBranch !== null && activeChangingBranch !== branch.name
                      }
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
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
