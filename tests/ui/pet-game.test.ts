import { describe, expect, test } from "bun:test";
import {
  PET_EASTER_EGG_TAPS,
  applyPetCareAction,
  createPetGameState,
  decayPetGameState,
  parsePetGameState,
  petMood,
  petStage,
  registerPetTap,
  resetPetGameState,
  serializePetGameState,
} from "../../shared/pet-game";
import {
  PET_SPRITE_ADULT,
  PET_SPRITE_ADULT_BLINK,
  PET_SPRITE_ADULT_SLEEP,
  PET_SPRITE_BABY,
  PET_SPRITE_EGG,
  PET_SPRITE_EGG_CRACK,
  PET_SPRITE_PALETTE,
  PET_SPRITE_WIDTH,
  petSpriteRows,
} from "../../shared/pet-sprite";

describe("pet sprites", () => {
  const sprites = {
    egg: PET_SPRITE_EGG,
    crack: PET_SPRITE_EGG_CRACK,
    baby: PET_SPRITE_BABY,
    adult: PET_SPRITE_ADULT,
    blink: PET_SPRITE_ADULT_BLINK,
    sleep: PET_SPRITE_ADULT_SLEEP,
  };

  test("every sprite is a square grid of known palette characters", () => {
    for (const [name, rows] of Object.entries(sprites)) {
      expect(`${name}:${rows.length}`).toBe(`${name}:${PET_SPRITE_WIDTH}`);
      for (const row of rows) {
        expect(`${name}:${row.length}`).toBe(`${name}:${PET_SPRITE_WIDTH}`);
        for (const char of row) {
          if (char === ".") continue;
          expect(`${name}:${char}:${char in PET_SPRITE_PALETTE}`).toBe(`${name}:${char}:true`);
        }
      }
    }
  });

  test("blinking closes the eyes and sleeping keeps them shut", () => {
    expect(PET_SPRITE_ADULT[7]).toContain("we");
    expect(PET_SPRITE_ADULT_BLINK[7]).not.toContain("we");
    expect(PET_SPRITE_ADULT_BLINK[7]).not.toContain("ee");
    expect(PET_SPRITE_ADULT_SLEEP[7]).toContain("oo");
  });

  test("stage picks the matching sprite", () => {
    expect(petSpriteRows("egg", "happy", false)).toBe(PET_SPRITE_EGG);
    expect(petSpriteRows("hatching", "happy", false)).toBe(PET_SPRITE_EGG_CRACK);
    expect(petSpriteRows("baby", "happy", false)).toBe(PET_SPRITE_BABY);
    expect(petSpriteRows("adult", "sleepy", false)).toBe(PET_SPRITE_ADULT_SLEEP);
    expect(petSpriteRows("adult", "happy", true)).toBe(PET_SPRITE_ADULT_BLINK);
  });
});

describe("pet game", () => {
  test("starts as an egg and grows through care", () => {
    let state = createPetGameState(0);
    expect(petStage(state)).toBe("egg");
    const seen: string[] = [];
    for (let index = 1; index <= 9; index += 1) {
      state = applyPetCareAction(state, "feed", index * 1000);
      seen.push(petStage(state));
    }
    expect(seen).toContain("hatching");
    expect(seen).toContain("baby");
    expect(seen[seen.length - 1]).toBe("adult");
  });

  test("stats decay over time and never leave their bounds", () => {
    const fresh = createPetGameState(0);
    const later = decayPetGameState(fresh, 60 * 60 * 1000);
    expect(later.hunger).toBeLessThan(fresh.hunger);
    expect(later.hunger).toBeGreaterThanOrEqual(0);

    const starved = decayPetGameState(fresh, 365 * 24 * 60 * 60 * 1000);
    expect(starved.hunger).toBe(0);
    expect(starved.energy).toBe(0);
  });

  test("care actions trade stats rather than only adding", () => {
    const base = { ...createPetGameState(0), joy: 50, energy: 50, hunger: 50 };
    const played = applyPetCareAction(base, "play", 0);
    expect(played.joy).toBeGreaterThan(base.joy);
    expect(played.energy).toBeLessThan(base.energy);

    const rested = applyPetCareAction(base, "rest", 0);
    expect(rested.energy).toBeGreaterThan(base.energy);
  });

  test("mood reflects the weakest need", () => {
    const base = createPetGameState(0);
    expect(petMood({ ...base, hunger: 10 })).toBe("hungry");
    expect(petMood({ ...base, energy: 10 })).toBe("sleepy");
    expect(petMood({ ...base, joy: 10 })).toBe("bored");
    expect(petMood({ ...base, hunger: 90, energy: 90, joy: 90 })).toBe("happy");
  });

  test("survives a round trip through storage and bad input", () => {
    const state = applyPetCareAction(createPetGameState(0), "feed", 1000);
    const restored = parsePetGameState(serializePetGameState(state), 1000);
    expect(restored.cares).toBe(state.cares);
    expect(restored.hunger).toBe(state.hunger);
    expect(parsePetGameState("not json", 0).cares).toBe(0);
    expect(parsePetGameState(null, 0).hunger).toBe(80);
  });

  test("starting over returns a grown pet to the egg", () => {
    let grown = createPetGameState(0);
    for (let index = 1; index <= 10; index += 1) {
      grown = applyPetCareAction(grown, "feed", index * 1000);
    }
    expect(petStage(grown)).toBe("adult");

    const fresh = resetPetGameState(20_000);
    expect(petStage(fresh)).toBe("egg");
    expect(fresh.cares).toBe(0);
    expect(fresh.bond).toBe(0);
  });

  test("the easter egg needs consecutive taps, not taps spread over time", () => {
    let taps = 0;
    let last = 0;
    let unlocked = false;
    for (let index = 1; index <= PET_EASTER_EGG_TAPS; index += 1) {
      const now = index * 120;
      const result = registerPetTap(taps, last, now);
      taps = result.taps;
      last = now;
      unlocked = result.unlocked;
    }
    expect(unlocked).toBe(true);

    const slow = registerPetTap(4, 0, 5_000);
    expect(slow.unlocked).toBe(false);
    expect(slow.taps).toBe(1);
  });
});
