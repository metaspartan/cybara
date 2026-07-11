export const MIN_LIGHTBOX_ZOOM = 0.5;
export const MAX_LIGHTBOX_ZOOM = 4;
export const LIGHTBOX_ZOOM_STEP = 0.25;

export function clampLightboxZoom(value: number): number {
  return Math.min(MAX_LIGHTBOX_ZOOM, Math.max(MIN_LIGHTBOX_ZOOM, value));
}

export function nextLightboxIndex(current: number, direction: -1 | 1, total: number): number {
  if (total <= 1) return 0;
  return (current + direction + total) % total;
}
