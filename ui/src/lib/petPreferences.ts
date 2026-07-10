const PET_ENABLED_KEY = "cybara:pet:enabled";
const PET_POSITION_KEY = "cybara:pet:position";

export const PET_CHANGED_EVENT = "cybara:pet-changed";

export interface PetPosition {
  x: number;
  y: number;
}

export function readPetEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PET_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function persistPetEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PET_ENABLED_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new CustomEvent(PET_CHANGED_EVENT));
  } catch {
    return;
  }
}

export function readPetPosition(): PetPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PET_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PetPosition;
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistPetPosition(position: PetPosition): void {
  try {
    window.localStorage.setItem(PET_POSITION_KEY, JSON.stringify(position));
  } catch {
    return;
  }
}
