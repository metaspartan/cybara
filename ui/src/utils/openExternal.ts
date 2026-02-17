import { apiFetch } from '@/lib/auth';

/**
 * Open a URL in the system browser.
 * Uses the backend /api/open-url endpoint which works in both
 * Tauri desktop and regular browser contexts.
 * Falls back to window.open() if the backend call fails.
 */
export async function openExternal(url: string): Promise<void> {
    try {
        const res = await apiFetch('/api/open-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        if (res.ok) {
            console.log('[openExternal] Opened via backend:', url.substring(0, 80));
            return;
        }
    } catch {
        // Backend unavailable, fall back
    }
    console.log('[openExternal] Falling back to window.open()');
    window.open(url, '_blank', 'noopener,noreferrer');
}
