import { ArrowRightLeft } from "lucide-react";
import type { AgentTransferInfo } from "@/types";

export function AgentTransferTimeline({
  transfers,
}: {
  transfers: AgentTransferInfo[] | undefined;
}) {
  if (!transfers?.length) return null;
  return (
    <div className="my-2 space-y-1.5" data-testid="agent-transfer-timeline">
      {transfers.map((transfer) => (
        <div
          key={`${transfer.fromAgentId}-${transfer.toAgentId}-${transfer.requestedAt}`}
          className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-secondary)]"
          title={`${transfer.reason}${transfer.contextSummary ? `\n${transfer.contextSummary}` : ""}`}
        >
          <ArrowRightLeft className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span className="truncate">
            Transferred from <span className="font-medium">{transfer.fromAgentName}</span> to{" "}
            <span className="font-medium">{transfer.toAgentName}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
