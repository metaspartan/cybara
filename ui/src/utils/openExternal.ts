import { open as openTauriExternal } from "@tauri-apps/plugin-shell";
import { isCybaraNativeRuntime, isTauriDesktopRuntime } from "@/lib/desktopHost";
import { apiFetch } from "@/lib/auth";

export async function openExternal(url: string): Promise<void> {
  if (isCybaraNativeRuntime() && window.__CYBARA_NATIVE__?.openExternal) {
    window.__CYBARA_NATIVE__.openExternal(url);
    return;
  }

  if (isTauriDesktopRuntime()) {
    try {
      await openTauriExternal(url);
      return;
    } catch {}
  }

  try {
    const res = await apiFetch("/api/open-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      return;
    }
  } catch {}

  window.open(url, "_blank", "noopener,noreferrer");
}
