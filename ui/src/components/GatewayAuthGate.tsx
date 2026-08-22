import { KeyRound, Loader2, RotateCw } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  clearApiAuthToken,
  clearGatewayAccessPassword,
  setApiAuthToken,
  setGatewayAccessPassword,
} from "@/lib/auth";
import {
  checkGatewayAccess,
  gatewayAccessRetryDelay,
  type GatewayAccessCheck,
  shouldDiscardGatewayCredentials,
} from "@/lib/gatewayAuth";
import { isTauriDesktopRuntime } from "@/lib/desktopHost";
import { ensureUpdatePolling } from "@/lib/updateStore";

export function GatewayAuthGate({ children }: { children: ReactNode }) {
  const desktopRuntime = isTauriDesktopRuntime();
  const [access, setAccess] = useState<GatewayAccessCheck>({
    message: "",
    status: "unavailable",
  });
  const [checking, setChecking] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [gatewayPassword, setGatewayPassword] = useState("");

  const verify = useCallback(async (showSpinner = true) => {
    if (showSpinner) setChecking(true);
    const result = await checkGatewayAccess();
    setAccess(result);
    if (showSpinner) setChecking(false);
    return result;
  }, []);

  useEffect(() => {
    void verify();
  }, [verify]);

  useEffect(() => {
    if (access.status === "ready") ensureUpdatePolling();
  }, [access.status]);

  useEffect(() => {
    const delay = gatewayAccessRetryDelay(access.status, desktopRuntime);
    if (checking || delay === false) return;
    let disposed = false;
    let timer = window.setTimeout(async function retryGateway(): Promise<void> {
      await verify(false);
      if (!disposed) timer = window.setTimeout(retryGateway, delay);
    }, delay);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [access.status, checking, desktopRuntime, verify]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) return;
    setApiAuthToken(key);
    if (gatewayPassword.trim()) {
      setGatewayAccessPassword(gatewayPassword);
    } else {
      clearGatewayAccessPassword();
    }
    const result = await verify();
    if (shouldDiscardGatewayCredentials(result)) clearApiAuthToken();
  }

  if (access.status === "ready" && !checking) return <>{children}</>;

  return (
    <main className="fixed inset-0 flex min-h-screen items-center justify-center bg-[#0a0a0f] px-5 text-gray-100">
      {checking ? (
        <div className="flex items-center gap-3 text-sm text-gray-400" role="status">
          <Loader2 className="h-5 w-5 animate-spin" />
          Connecting to Cybara
        </div>
      ) : access.status === "required" ? (
        <form className="w-full max-w-sm space-y-5" onSubmit={submit}>
          <div className="flex items-center gap-3">
            <img src="/cybara.png" alt="" className="h-11 w-11 object-contain" />
            <div>
              <h1 className="text-lg font-semibold text-gray-100">Unlock Cybara</h1>
              <p className="text-sm text-gray-500">Authenticate with this gateway</p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="block space-y-1.5 text-sm text-gray-300">
              <span>API key</span>
              <input
                autoComplete="current-password"
                autoFocus
                className="h-10 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-white/20"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Paste the gateway API key"
                type="password"
                value={apiKey}
              />
            </label>
            <label className="block space-y-1.5 text-sm text-gray-300">
              <span>
                Gateway password <span className="text-gray-600">Optional</span>
              </span>
              <input
                autoComplete="current-password"
                className="h-10 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-white/20"
                onChange={(event) => setGatewayPassword(event.target.value)}
                placeholder="Only needed when configured"
                type="password"
                value={gatewayPassword}
              />
            </label>
          </div>
          {access.message ? (
            <p className="text-sm text-red-300" role="alert">
              {access.message}
            </p>
          ) : null}
          <button
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-medium text-gray-950 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!apiKey.trim()}
            type="submit"
          >
            <KeyRound className="h-4 w-4" />
            Unlock
          </button>
          <p className="text-xs leading-5 text-gray-600">
            Reveal the key from Settings &gt; Gateway in the desktop app. It remains in this browser
            tab only.
          </p>
        </form>
      ) : (
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <img src="/cybara.png" alt="" className="h-12 w-12 object-contain" />
          <div>
            <h1 className="text-lg font-semibold text-gray-100">Gateway unavailable</h1>
            <p className="mt-1 text-sm text-gray-500">{access.message}</p>
            {desktopRuntime ? (
              <p className="mt-2 text-xs text-gray-600">Reconnecting automatically…</p>
            ) : null}
          </div>
          <button
            className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-gray-300 hover:bg-white/[0.05]"
            onClick={() => void verify()}
            type="button"
          >
            <RotateCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}
    </main>
  );
}
