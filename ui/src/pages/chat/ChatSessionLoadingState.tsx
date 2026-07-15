import { Loader2 } from "lucide-react";
import type { ReactElement } from "react";

export function ChatSessionLoadingState(): ReactElement {
  return (
    <div className="flex min-h-[240px] w-full items-center justify-center" role="status">
      <div className="flex items-center gap-2 text-sm theme-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading chat...</span>
      </div>
    </div>
  );
}
