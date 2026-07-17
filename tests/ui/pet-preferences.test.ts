import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePetEnabled, readPetEnabled } from "../../ui/src/lib/petPreferences";
import { PET_WINDOW_URL } from "../../ui/src/lib/tauriPet";
import { readNativeSettingsSource, readUiStylesSource } from "../shared/source-bundles";

const nativeSettingsSource = readNativeSettingsSource();
const nativePetSource = readFileSync(
  fileURLToPath(new URL("../../apps/macos/Cybara/Sources/Cybara/PetPanel.swift", import.meta.url)),
  "utf8"
);
const webPetSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/components/CybaraPet.tsx", import.meta.url)),
  "utf8"
);
const overlaySource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/PetOverlay.tsx", import.meta.url)),
  "utf8"
);
const cssSource = readUiStylesSource();
const htmlSource = readFileSync(
  fileURLToPath(new URL("../../ui/index.html", import.meta.url)),
  "utf8"
);

describe("pet preferences", () => {
  test("requires an explicit opt-in", () => {
    expect(parsePetEnabled(null)).toBe(false);
    expect(parsePetEnabled("0")).toBe(false);
    expect(parsePetEnabled("true")).toBe(false);
    expect(parsePetEnabled("1")).toBe(true);
    expect(readPetEnabled()).toBe(false);
  });

  test("keeps native macOS disabled until explicitly enabled", () => {
    expect(nativeSettingsSource).toContain(
      '@AppStorage("cybara.petEnabled") var petEnabled = false'
    );
    expect(nativePetSource).toContain(
      'UserDefaults.standard.object(forKey: "cybara.petEnabled") as? Bool ?? false'
    );
  });

  test("renders the real transparent mascot without blob chrome", () => {
    expect(nativePetSource).toContain("CybaraBrand.logoImage");
    expect(nativePetSource).not.toContain("Bundle.module");
    expect(nativePetSource).not.toContain("Circle().fill");
    expect(webPetSource).toContain('src="/cybara.png"');
    expect(webPetSource).toContain("<CybaraThinkingMark />");
    expect(webPetSource).toContain("object-contain");
    expect(webPetSource).not.toContain("bg-[#12121a]/90");
    expect(overlaySource).toContain('import cybaraLogoUrl from "../../public/cybara.png"');
    expect(overlaySource).toContain("src={cybaraLogoUrl}");
    expect(overlaySource).toContain("<CybaraThinkingMark />");
    expect(overlaySource).toContain("pet-mascot-button");
    expect(overlaySource).not.toContain("drop-shadow-xl");
    expect(overlaySource).not.toContain("cybara-pet-idle");
    expect(cssSource).toContain(".pet-mascot-button");
    expect(htmlSource).toContain("html.pet-window body");
    expect(htmlSource).toContain("html.pet-window body::before");
    expect(htmlSource).toContain("content: none !important");
    expect(PET_WINDOW_URL).toBe("http://127.0.0.1:4269/?pet=1");
    expect(overlaySource).not.toContain("bg-[#12121a] cursor-grab");
  });
});
