export const PET_SPRITE_PALETTE: Record<string, string> = {
  o: "#3B2416",
  f: "#C68A52",
  d: "#8C5A2E",
  m: "#9AA3AD",
  e: "#241309",
  w: "#FFFFFF",
  r: "#F58220",
  c: "#F2E4CE",
};

export const PET_SPRITE_WIDTH = 16;

export const PET_SPRITE_EGG = [
  "................",
  "......oooo......",
  ".....occcco.....",
  "....occcccco....",
  "...occcccccco...",
  "...occcccccco...",
  "..occcccccccco..",
  "..orrccccccrro..",
  "..occcccccccco..",
  "..orrccccccrro..",
  "..occcccccccco..",
  "...occcccccco...",
  "....occcccco....",
  ".....occcco.....",
  "......oooo......",
  "................",
];

export const PET_SPRITE_EGG_CRACK = [
  "................",
  "......oooo......",
  ".....occcco.....",
  "....occcccco....",
  "...occcccccco...",
  "...occoccocco...",
  "..occcoccocccо..".replace("о", "o"),
  "..orrccccccrro..",
  "..occoccccocco..",
  "..orrccccccrro..",
  "..occcccccccco..",
  "...occcccccco...",
  "....occcccco....",
  ".....occcco.....",
  "......oooo......",
  "................",
];

export const PET_SPRITE_BABY = [
  "................",
  "................",
  "................",
  "........r.......",
  ".......oro......",
  ".....oooooo.....",
  "....offffffo....",
  "....offffffo....",
  "....owffffwo....",
  "....offffffo....",
  "....offddffo....",
  ".....oooooo.....",
  ".....oo..oo.....",
  "................",
  "................",
  "................",
];

export const PET_SPRITE_ADULT = [
  "................",
  ".......rr.......",
  "......orro......",
  "...oooooooooo...",
  "..offffffffffo..",
  ".offffffffffffo.",
  ".offffffffffffo.",
  ".offweffffweffo.",
  ".offeeffffeeffo.",
  ".offffffffffmmo.",
  ".offffddddffmmo.",
  ".offffddddffffo.",
  ".offffffffffffo.",
  "..offffffffffo..",
  "...oooooooooo...",
  "...oo......oo...",
];

const ADULT_EYE_ROWS = { open: 7, lower: 8 };

export const PET_SPRITE_ADULT_BLINK = PET_SPRITE_ADULT.map((row, index) =>
  index === ADULT_EYE_ROWS.open || index === ADULT_EYE_ROWS.lower
    ? row.replace(/we|ee/g, "ff")
    : row
);

export const PET_SPRITE_ADULT_SLEEP = PET_SPRITE_ADULT.map((row, index) =>
  index === ADULT_EYE_ROWS.open
    ? row.replace(/we/g, "oo")
    : index === ADULT_EYE_ROWS.lower
      ? row.replace(/ee/g, "ff")
      : row
);

export type PetSpriteStage = "egg" | "hatching" | "baby" | "adult";

export function petSpriteRows(
  stage: PetSpriteStage,
  mood: string,
  blink: boolean
): readonly string[] {
  if (stage === "egg") return PET_SPRITE_EGG;
  if (stage === "hatching") return PET_SPRITE_EGG_CRACK;
  if (stage === "baby") return PET_SPRITE_BABY;
  if (mood === "sleepy") return PET_SPRITE_ADULT_SLEEP;
  return blink ? PET_SPRITE_ADULT_BLINK : PET_SPRITE_ADULT;
}

export function petSpriteSize(rows: readonly string[]): { width: number; height: number } {
  return { width: Math.max(...rows.map((row) => row.length)), height: rows.length };
}
