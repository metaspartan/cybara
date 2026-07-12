const PRELOAD_RECOVERY_KEY = "cybara:preload-recovery";
const PRELOAD_RECOVERY_WINDOW_MS = 30_000;
const PRELOAD_RECOVERY_CLEAR_MS = 10_000;

export function shouldRecoverPreloadError(lastRecoveryMs: number, nowMs: number): boolean {
  return !Number.isFinite(lastRecoveryMs) || nowMs - lastRecoveryMs >= PRELOAD_RECOVERY_WINDOW_MS;
}

export function installPreloadRecovery(): () => void {
  const handlePreloadError = (event: Event): void => {
    const nowMs = Date.now();
    const lastRecoveryMs = Number(window.sessionStorage.getItem(PRELOAD_RECOVERY_KEY));
    if (!shouldRecoverPreloadError(lastRecoveryMs, nowMs)) return;
    event.preventDefault();
    window.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, String(nowMs));
    window.location.reload();
  };

  window.addEventListener("vite:preloadError", handlePreloadError);
  const clearTimer = window.setTimeout(() => {
    window.sessionStorage.removeItem(PRELOAD_RECOVERY_KEY);
  }, PRELOAD_RECOVERY_CLEAR_MS);

  return () => {
    window.removeEventListener("vite:preloadError", handlePreloadError);
    window.clearTimeout(clearTimer);
  };
}
