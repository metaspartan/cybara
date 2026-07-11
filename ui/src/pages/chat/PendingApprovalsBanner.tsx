import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

interface PendingApproval {
  id: string;
  toolName: string;
  argsSummary: string;
  createdAt: number;
}

export function PendingApprovalsBanner() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await apiFetch("/api/tools/approvals");
        const data = (await response.json()) as { pending?: unknown };
        if (active && Array.isArray(data.pending)) setApprovals(data.pending as PendingApproval[]);
      } catch {
        void 0;
      }
    };
    void poll();
    const interval = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const resolve = async (requestId: string, decision: string) => {
    try {
      await apiFetch("/api/tools/approvals/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });
      setApprovals((current) => current.filter((approval) => approval.id !== requestId));
    } catch {
      void 0;
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (approvals.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10">
      {approvals.map((request) => (
        <PendingApprovalRow
          key={request.id}
          request={request}
          onResolve={resolve}
          expanded={expandedIds.has(request.id)}
          onToggle={() => toggleExpanded(request.id)}
        />
      ))}
    </div>
  );
}

function PendingApprovalRow({
  request,
  onResolve,
  expanded,
  onToggle,
}: {
  request: PendingApproval;
  onResolve: (requestId: string, decision: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail = request.argsSummary.trim().length > 0;

  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <button
          type="button"
          onClick={() => hasDetail && onToggle()}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
          title={hasDetail ? "Show details" : undefined}
        >
          <span className="font-medium text-amber-200 shrink-0">{request.toolName}</span>
          {hasDetail ? (
            <>
              <span className="font-mono text-xs text-amber-200/60 truncate">
                {request.argsSummary}
              </span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-amber-300/70 shrink-0 transition-transform",
                  expanded && "rotate-180"
                )}
              />
            </>
          ) : null}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onResolve(request.id, "approve_once")}
            className="rounded px-2 py-0.5 text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors whitespace-nowrap"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => onResolve(request.id, "approve_session")}
            className="rounded px-2 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors whitespace-nowrap"
          >
            Allow session
          </button>
          <button
            type="button"
            onClick={() => onResolve(request.id, "deny")}
            className="rounded px-2 py-0.5 text-xs font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors whitespace-nowrap"
          >
            Deny
          </button>
        </div>
      </div>
      {expanded && hasDetail ? (
        <pre className="mt-1.5 ml-6 max-h-48 overflow-auto rounded bg-black/30 p-2 text-xs font-mono text-amber-100/80 whitespace-pre-wrap break-all">
          {request.argsSummary}
        </pre>
      ) : null}
    </div>
  );
}
