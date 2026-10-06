import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, Unlink } from "lucide-react";
import { apiFetch } from "@/lib/auth";

interface LocalChromeTarget {
  id: string;
  title: string;
  url: string;
}

interface LocalChromeStatus {
  supported: boolean;
  attached: boolean;
  reachable: boolean;
  product: string | null;
  port: number;
  targets: LocalChromeTarget[];
  reason?: string;
}

interface LocalChromeResponse {
  success: boolean;
  error?: string;
  status?: LocalChromeStatus;
}

export function LocalChromePanel(): React.JSX.Element {
  const [status, setStatus] = useState<LocalChromeStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await apiFetch("/api/browser/local-chrome");
      const data = (await response.json()) as LocalChromeResponse;
      if (!data.success) {
        setError(data.error ?? "Local Chrome is unavailable");
        return;
      }
      setError("");
      if (data.status) setStatus(data.status);
    } catch {
      setError("Could not reach the local browser service");
    }
  }, []);

  const run = useCallback(async (path: string): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(path, { method: "POST" });
      const data = (await response.json()) as LocalChromeResponse;
      if (!data.success) setError(data.error ?? "The request was refused");
      if (data.status) setStatus(data.status);
    } catch {
      setError("The local browser service did not respond");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-2 rounded-md border border-[rgb(var(--border-subtle))] p-3">
      <header className="flex items-center gap-2">
        <Globe size={16} aria-hidden />
        <h3 className="text-sm font-medium">Your own Chrome</h3>
      </header>
      <p className="text-xs text-[rgb(var(--text-secondary))]">
        Drive the Chrome you already use, with its real tabs and signed-in sessions.
      </p>
      {status?.attached ? (
        <>
          <p className="text-xs">
            Connected on port {status.port}
            {status.product ? ` · ${status.product}` : ""} · {status.targets.length} tab(s)
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-[rgb(var(--text-secondary))]">
            {status.targets.map((target) => (
              <li key={target.id} className="truncate">
                {target.title || target.url}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-subtle))] px-2 py-1 text-xs font-medium hover:bg-[rgb(var(--surface-raised))] disabled:opacity-50"
            disabled={busy}
            onClick={() => void run("/api/browser/local-chrome/detach")}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
            Disconnect
          </button>
        </>
      ) : (
        <>
          {status?.reason ? (
            <p className="text-xs text-[rgb(var(--text-tertiary))]">{status.reason}</p>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-subtle))] px-2 py-1 text-xs font-medium hover:bg-[rgb(var(--surface-raised))] disabled:opacity-50"
            disabled={busy}
            onClick={() => void run("/api/browser/local-chrome/attach")}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            Connect to Chrome
          </button>
        </>
      )}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
