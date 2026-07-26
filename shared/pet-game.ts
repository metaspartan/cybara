export type PetCareAction = "feed" | "play" | "rest";
export type PetMood = "happy" | "content" | "hungry" | "sleepy" | "bored";

export interface PetGameState {
  hunger: number;
  energy: number;
  joy: number;
  bond: number;
  cares: number;
  updatedAt: number;
}

export const PET_STAT_MAX = 100;
export const PET_DECAY_PER_MINUTE = { hunger: 1.6, energy: 1.1, joy: 1.3 };
const PET_MAX_OFFLINE_MINUTES = 12 * 60;

export const PET_EASTER_EGG_TAPS = 5;
export const PET_EASTER_EGG_GAP_MS = 900;

export function registerPetTap(
  taps: number,
  lastTapAt: number,
  now: number
): { taps: number; unlocked: boolean } {
  const next = now - lastTapAt <= PET_EASTER_EGG_GAP_MS ? taps + 1 : 1;
  return { taps: next >= PET_EASTER_EGG_TAPS ? 0 : next, unlocked: next >= PET_EASTER_EGG_TAPS };
}

export function createPetGameState(now = Date.now()): PetGameState {
  return { hunger: 80, energy: 80, joy: 80, bond: 0, cares: 0, updatedAt: now };
}

function clampStat(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PET_STAT_MAX, Math.round(value)));
}

export function decayPetGameState(state: PetGameState, now: number): PetGameState {
  const elapsedMinutes = Math.min(
    PET_MAX_OFFLINE_MINUTES,
    Math.max(0, (now - state.updatedAt) / 60_000)
  );
  if (elapsedMinutes <= 0) return { ...state, updatedAt: now };
  return {
    hunger: clampStat(state.hunger - elapsedMinutes * PET_DECAY_PER_MINUTE.hunger),
    energy: clampStat(state.energy - elapsedMinutes * PET_DECAY_PER_MINUTE.energy),
    joy: clampStat(state.joy - elapsedMinutes * PET_DECAY_PER_MINUTE.joy),
    bond: clampStat(state.bond),
    cares: state.cares,
    updatedAt: now,
  };
}

export function applyPetCareAction(
  state: PetGameState,
  action: PetCareAction,
  now = Date.now()
): PetGameState {
  const current = decayPetGameState(state, now);
  const next = { ...current };
  if (action === "feed") {
    next.hunger = clampStat(current.hunger + 34);
    next.joy = clampStat(current.joy + 6);
  } else if (action === "play") {
    next.joy = clampStat(current.joy + 30);
    next.energy = clampStat(current.energy - 12);
    next.hunger = clampStat(current.hunger - 6);
  } else {
    next.energy = clampStat(current.energy + 36);
    next.joy = clampStat(current.joy - 4);
  }
  const cared = next.hunger > current.hunger || next.joy > current.joy || next.energy > current.energy;
  next.bond = clampStat(current.bond + (cared ? 2 : 0));
  next.cares = current.cares + 1;
  next.updatedAt = now;
  return next;
}

export function petMood(state: PetGameState): PetMood {
  if (state.hunger <= 30) return "hungry";
  if (state.energy <= 30) return "sleepy";
  if (state.joy <= 30) return "bored";
  if (state.hunger >= 70 && state.energy >= 70 && state.joy >= 70) return "happy";
  return "content";
}

export function petMoodLabel(mood: PetMood): string {
  if (mood === "hungry") return "Wants a snack";
  if (mood === "sleepy") return "Getting sleepy";
  if (mood === "bored") return "Wants to play";
  if (mood === "happy") return "Thriving";
  return "Doing fine";
}

export const PET_HATCH_CARES = 3;
export const PET_GROW_CARES = 8;

export function petStage(state: PetGameState): "egg" | "hatching" | "baby" | "adult" {
  if (state.cares >= PET_GROW_CARES) return "adult";
  if (state.cares >= PET_HATCH_CARES) return "baby";
  if (state.cares >= PET_HATCH_CARES - 1) return "hatching";
  return "egg";
}

export function petLevel(state: PetGameState): number {
  return 1 + Math.floor(state.bond / 20);
}

export function resetPetGameState(now = Date.now()): PetGameState {
  return createPetGameState(now);
}

export function serializePetGameState(state: PetGameState): string {
  return JSON.stringify(state);
}

export function parsePetGameState(raw: string | null, now = Date.now()): PetGameState {
  if (!raw) return createPetGameState(now);
  try {
    const parsed = JSON.parse(raw) as Partial<PetGameState>;
    if (!parsed || typeof parsed !== "object") return createPetGameState(now);
    return decayPetGameState(
      {
        hunger: clampStat(Number(parsed.hunger ?? 80)),
        energy: clampStat(Number(parsed.energy ?? 80)),
        joy: clampStat(Number(parsed.joy ?? 80)),
        bond: clampStat(Number(parsed.bond ?? 0)),
        cares: Math.max(0, Math.round(Number(parsed.cares ?? 0)) || 0),
        updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : now,
      },
      now
    );
  } catch {
    return createPetGameState(now);
  }
}
