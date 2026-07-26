import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PET_DECAY_PER_MINUTE,
  PET_EASTER_EGG_GAP_MS,
  PET_EASTER_EGG_TAPS,
  PET_GROW_CARES,
  PET_HATCH_CARES,
  PET_STAT_MAX,
} from "../../shared/pet-game";
import {
  PET_SPRITE_ADULT,
  PET_SPRITE_BABY,
  PET_SPRITE_EGG,
  PET_SPRITE_EGG_CRACK,
  PET_SPRITE_WIDTH,
} from "../../shared/pet-sprite";

const swift = readFileSync(
  join(process.cwd(), "apps/macos/Cybara/Sources/Cybara/PetGame.swift"),
  "utf8"
);

function swiftSprite(name: string): string[] {
  const start = swift.indexOf(`static let ${name} = [`);
  if (start < 0) throw new Error(`missing swift sprite ${name}`);
  const end = swift.indexOf("]", start);
  return swift
    .slice(start, end)
    .split("\n")
    .map((line) => line.trim().replace(/^"/, "").replace(/",$/, ""))
    .filter((line) => /^[.a-z]+$/.test(line) && line.length === PET_SPRITE_WIDTH);
}

describe("macOS pet parity", () => {
  test("game constants match the shared module", () => {
    expect(swift).toContain(`static let statMax = ${PET_STAT_MAX}`);
    expect(swift).toContain(`static let hatchCares = ${PET_HATCH_CARES}`);
    expect(swift).toContain(`static let growCares = ${PET_GROW_CARES}`);
    expect(swift).toContain(`static let easterEggTaps = ${PET_EASTER_EGG_TAPS}`);
    expect(swift).toContain(`static let easterEggGapMs = ${PET_EASTER_EGG_GAP_MS}.0`);
    expect(swift).toContain(`hungerDecayPerMinute = ${PET_DECAY_PER_MINUTE.hunger}`);
    expect(swift).toContain(`energyDecayPerMinute = ${PET_DECAY_PER_MINUTE.energy}`);
    expect(swift).toContain(`joyDecayPerMinute = ${PET_DECAY_PER_MINUTE.joy}`);
    expect(swift).toContain(`static let width = ${PET_SPRITE_WIDTH}`);
  });

  test("every sprite stage is pixel identical to the web version", () => {
    const pairs: Array<[string, readonly string[]]> = [
      ["egg", PET_SPRITE_EGG],
      ["eggCrack", PET_SPRITE_EGG_CRACK],
      ["baby", PET_SPRITE_BABY],
      ["adult", PET_SPRITE_ADULT],
    ];
    for (const [name, expected] of pairs) {
      const actual = swiftSprite(name);
      expect(`${name}:${actual.length}`).toBe(`${name}:${expected.length}`);
      expect(actual.join("\n")).toBe([...expected].join("\n"));
    }
  });

  test("macOS shares the same storage key so state carries across surfaces", () => {
    expect(swift).toContain('static let storageKey = "cybara.pet.game"');
  });

  test("the mascot still opens chat on a single click", () => {
    const panel = readFileSync(
      join(process.cwd(), "apps/macos/Cybara/Sources/Cybara/PetPanel.swift"),
      "utf8"
    );
    expect(panel).toContain("NotificationCenter.default.post(name: .cybaraPetOpenChat");
    expect(panel).toContain("PetGame.registerTap(");
    expect(panel).toContain("Start over");
  });
});
