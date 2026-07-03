import { apiFetch } from "@/lib/auth";

export async function openExternal(url: string): Promise<void> {
  try {
    const res = await apiFetch("/api/open-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      console.log("[openExternal] Opened via backend:", url.substring(0, 80));
      return;
    }
  } catch {}
  console.log("[openExternal] Falling back to window.open()");
  window.open(url, "_blank", "noopener,noreferrer");
}
