import { useSyncExternalStore } from "react";

export const DEFAULT_UNREAD_DOT_COLOR = "#38bdf8";
const UNREAD_DOT_COLOR_KEY = "cybara-unread-dot-color";
const UNREAD_DOT_COLOR_EVENT = "cybara:unread-dot-color-changed";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeUnreadDotColor(value: unknown): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim())
    ? value.trim().toLowerCase()
    : DEFAULT_UNREAD_DOT_COLOR;
}

export function readUnreadDotColor(): string {
  if (typeof window === "undefined") return DEFAULT_UNREAD_DOT_COLOR;
  try {
    return normalizeUnreadDotColor(window.localStorage.getItem(UNREAD_DOT_COLOR_KEY));
  } catch {
    return DEFAULT_UNREAD_DOT_COLOR;
  }
}

export function persistUnreadDotColor(color: string): void {
  const normalized = normalizeUnreadDotColor(color);
  try {
    window.localStorage.setItem(UNREAD_DOT_COLOR_KEY, normalized);
    window.dispatchEvent(new CustomEvent(UNREAD_DOT_COLOR_EVENT));
  } catch {
    return;
  }
}

function subscribeUnreadDotColor(onChange: () => void): () => void {
  const listener = (): void => onChange();
  window.addEventListener(UNREAD_DOT_COLOR_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(UNREAD_DOT_COLOR_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useUnreadDotColor(): string {
  return useSyncExternalStore(
    subscribeUnreadDotColor,
    readUnreadDotColor,
    () => DEFAULT_UNREAD_DOT_COLOR
  );
}
