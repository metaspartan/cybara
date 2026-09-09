import { AlertTriangle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { restartDesktopGateway, switchToLocalGateway } from "@/lib/desktopGatewayStartup";

export interface GatewayStartupFailureProps {
  message: string;
  canSwitchToLocal?: boolean;
}

export function GatewayStartupFailure({
  message,
  canSwitchToLocal = false,
}: GatewayStartupFailureProps) {
  const [retrying, setRetrying] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function retry(): Promise<void> {
    setRetrying(true);
    if (!(await restartDesktopGateway())) {
      window.location.reload();
    }
  }

  async function switchToLocal(): Promise<void> {
    if (!window.confirm("Stop following the external gateway and start a new local gateway?"))
      return;
    setRetrying(true);
    setSwitchError(null);
    const error = await switchToLocalGateway();
    if (error) {
      setSwitchError(error);
      setRetrying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold">
              {canSwitchToLocal ? "External gateway unavailable" : "Gateway could not start"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="h-4 w-4" />
            {retrying ? "Retrying…" : "Retry"}
          </button>
          {canSwitchToLocal ? (
            <button
              type="button"
              onClick={() => void switchToLocal()}
              disabled={retrying}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Use local gateway
            </button>
          ) : null}
        </div>
        {switchError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {switchError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
