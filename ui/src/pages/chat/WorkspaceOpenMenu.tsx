import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Code2,
  Compass,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  Terminal,
} from "lucide-react";
import { workspaceOpenApi, type WorkspaceOpenTarget } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";

const WORKSPACE_TARGET_LOAD_TIMEOUT_MS = 3_000;
const MONOCHROME_TARGET_IDS = new Set(["cursor", "windsurf", "pearai"]);
const FALLBACK_WORKSPACE_TARGETS: WorkspaceOpenTarget[] = [
  {
    id: "cybara_ide",
    label: "Cybara IDE",
    kind: "internal",
    icon: "cybara",
    iconUrl: "/cybara.png",
    available: true,
    detail: "Open in Cybara's workspace IDE",
  },
];

interface WorkspaceOpenMenuProps {
  workspaceDir: string | null;
  workspaceSaving?: boolean;
  onSelectWorkspace: () => void | Promise<void>;
  onOpenCybaraIde: (workspaceDir: string) => void | Promise<void>;
}

function targetIcon(target: WorkspaceOpenTarget) {
  if (target.iconUrl) {
    return (
      <img
        src={target.iconUrl}
        alt=""
        className={cn(
          "h-4 w-4 shrink-0 rounded-[4px] object-contain",
          MONOCHROME_TARGET_IDS.has(target.id) && "invert dark:invert-0"
        )}
        loading="lazy"
      />
    );
  }
  if (target.id === "cybara_ide") return <Monitor className="h-3.5 w-3.5 text-amber-300" />;
  if (target.kind === "terminal") return <Terminal className="theme-muted-icon h-3.5 w-3.5" />;
  if (target.kind === "file-manager") return <FolderOpen className="h-3.5 w-3.5 text-blue-300" />;
  if (target.id === "xcode") return <Compass className="h-3.5 w-3.5 text-sky-300" />;
  return <Code2 className="h-3.5 w-3.5 text-emerald-300" />;
}

function workspaceFolderName(workspaceDir: string): string {
  const normalized = workspaceDir.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/);
  return parts[parts.length - 1] || normalized || "Workspace";
}

export function WorkspaceOpenMenu({
  workspaceDir,
  workspaceSaving = false,
  onSelectWorkspace,
  onOpenCybaraIde,
}: WorkspaceOpenMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetLoadRequestRef = useRef(0);
  const targetLoadAbortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [targets, setTargets] = useState<WorkspaceOpenTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingTargetId, setOpeningTargetId] = useState<string | null>(null);
  const addToast = useUIStore((state) => state.addToast);
  const trimmedWorkspace = workspaceDir?.trim() || null;
  const workspaceName = trimmedWorkspace ? workspaceFolderName(trimmedWorkspace) : null;

  const loadTargets = useCallback(async () => {
    if (!trimmedWorkspace) return;
    const requestId = targetLoadRequestRef.current + 1;
    targetLoadRequestRef.current = requestId;
    targetLoadAbortRef.current?.abort();
    const controller = new AbortController();
    targetLoadAbortRef.current = controller;
    let timedOut = false;
    setLoading(true);
    const timeoutId = window.setTimeout(() => {
      if (targetLoadRequestRef.current !== requestId) return;
      timedOut = true;
      controller.abort();
      setTargets((current) => (current.length > 0 ? current : FALLBACK_WORKSPACE_TARGETS));
      setLoading(false);
      addToast("error", "App detection is taking longer than expected. Cybara IDE is still ready.");
    }, WORKSPACE_TARGET_LOAD_TIMEOUT_MS);
    try {
      const response = await workspaceOpenApi.targets(trimmedWorkspace, controller.signal);
      if (targetLoadRequestRef.current !== requestId) return;
      if (!response.success || !response.data?.success) {
        throw new Error(response.data?.error || response.error || "Unable to load open targets");
      }
      setTargets(response.data.targets);
    } catch (error) {
      if (targetLoadRequestRef.current !== requestId || timedOut) return;
      setTargets(FALLBACK_WORKSPACE_TARGETS);
      addToast("error", error instanceof Error ? error.message : "Unable to load open targets");
    } finally {
      window.clearTimeout(timeoutId);
      if (targetLoadAbortRef.current === controller) targetLoadAbortRef.current = null;
      if (targetLoadRequestRef.current === requestId && !timedOut) setLoading(false);
    }
  }, [addToast, trimmedWorkspace]);

  useEffect(() => {
    if (!trimmedWorkspace) {
      targetLoadAbortRef.current?.abort();
      targetLoadAbortRef.current = null;
      setTargets([]);
      setOpen(false);
      return;
    }
    setTargets([]);
    setLoading(false);
  }, [trimmedWorkspace]);

  useEffect(
    () => () => {
      targetLoadAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!open || !trimmedWorkspace || targets.length > 0 || loading) return;
    void loadTargets();
  }, [loadTargets, loading, open, targets.length, trimmedWorkspace]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const sortedTargets = useMemo(
    () =>
      [...targets].sort((left, right) => {
        if (left.id === "cybara_ide") return -1;
        if (right.id === "cybara_ide") return 1;
        return left.label.localeCompare(right.label);
      }),
    [targets]
  );

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 224;
    const padding = 8;
    setMenuPosition({
      left: Math.max(
        padding,
        Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - padding)
      ),
      top: Math.min(rect.bottom + 8, window.innerHeight - padding),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onMove = () => updateMenuPosition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, updateMenuPosition]);

  const openTarget = async (target: WorkspaceOpenTarget) => {
    if (!trimmedWorkspace) return;
    setOpeningTargetId(target.id);
    try {
      if (target.id === "cybara_ide") {
        const response = await workspaceOpenApi.open(trimmedWorkspace, target.id);
        if (!response.success || response.data?.success === false) {
          throw new Error(
            response.data?.error || response.error || "Unable to open workspace in Cybara IDE"
          );
        }
        await onOpenCybaraIde(response.data?.path || trimmedWorkspace);
        setOpen(false);
        return;
      }
      const response = await workspaceOpenApi.open(trimmedWorkspace, target.id);
      if (!response.success || response.data?.success === false) {
        throw new Error(response.data?.error || response.error || `Unable to open ${target.label}`);
      }
      addToast("success", `Opened ${workspaceFolderName(trimmedWorkspace)} in ${target.label}`);
      setOpen(false);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : `Unable to open ${target.label}`);
    } finally {
      setOpeningTargetId(null);
    }
  };

  const menu =
    open &&
    trimmedWorkspace &&
    createPortal(
      <div
        ref={menuRef}
        className="workspace-open-menu-panel fixed z-[1000] w-56 overflow-hidden rounded-xl border border-white/10 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.65)]"
        style={{
          left: menuPosition.left,
          top: menuPosition.top,
          backgroundColor: "var(--workspace-open-menu-bg)",
        }}
      >
        <div className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.12em] text-gray-500">
          {workspaceName}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Detecting apps…
          </div>
        ) : (
          sortedTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => void openTarget(target)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-gray-100 transition-colors hover:bg-white/10"
            >
              {openingTargetId === target.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
              ) : (
                targetIcon(target)
              )}
              <span className="min-w-0 flex-1 truncate">{target.label}</span>
            </button>
          ))
        )}
        <div className="my-1 h-px bg-white/10" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onSelectWorkspace();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Change workspace…
        </button>
      </div>,
      document.body
    );

  if (!trimmedWorkspace) {
    return (
      <button
        onClick={onSelectWorkspace}
        disabled={workspaceSaving}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1.5 text-[11px] text-blue-300 transition-colors hover:bg-blue-500/15 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
        title="Select workspace folder for this session"
      >
        {workspaceSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FolderOpen className="h-3.5 w-3.5" />
        )}
        <span className="hidden md:inline font-mono">Select Workspace</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          updateMenuPosition();
          setOpen((value) => !value);
        }}
        disabled={workspaceSaving}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5 text-[11px] text-gray-200 transition-colors hover:border-white/15 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-60",
          open && "border-white/20 bg-white/[0.1]"
        )}
        title={`Workspace: ${trimmedWorkspace}`}
      >
        {workspaceSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <HardDrive className="h-3.5 w-3.5 text-gray-400" />
        )}
        <span className="hidden md:inline">Open in</span>
        <ChevronDown
          className={cn("h-3 w-3 text-gray-500 transition-transform", open && "rotate-180")}
        />
      </button>
      {menu}
    </div>
  );
}
