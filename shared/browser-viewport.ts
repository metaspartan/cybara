export type BrowserViewportMode = "responsive" | "mobile" | "desktop";

export interface BrowserViewport {
  width: number;
  height: number;
}

export const DEFAULT_BROWSER_VIEWPORT: BrowserViewport = { width: 960, height: 640 };

export const BROWSER_VIEWPORT_PRESETS: Record<BrowserViewportMode, BrowserViewport> = {
  responsive: DEFAULT_BROWSER_VIEWPORT,
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

export function isBrowserViewportMode(value: unknown): value is BrowserViewportMode {
  return value === "responsive" || value === "mobile" || value === "desktop";
}

export function parseBrowserViewportMode(value: unknown): BrowserViewportMode {
  return isBrowserViewportMode(value) ? value : "responsive";
}

export function browserViewportPreset(mode: BrowserViewportMode): BrowserViewport {
  return BROWSER_VIEWPORT_PRESETS[mode];
}

export function inferBrowserViewportMode(
  viewport: BrowserViewport | null | undefined
): BrowserViewportMode | null {
  if (!viewport) return null;
  for (const mode of Object.keys(BROWSER_VIEWPORT_PRESETS) as BrowserViewportMode[]) {
    const preset = BROWSER_VIEWPORT_PRESETS[mode];
    if (preset.width === viewport.width && preset.height === viewport.height) return mode;
  }
  return null;
}
