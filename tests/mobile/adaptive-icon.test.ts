import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

function alphaBounds(path: string): {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const image = PNG.sync.read(readFileSync(path));
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3] ?? 0;
      if (alpha === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { width: image.width, height: image.height, left, top, right, bottom };
}

function pixel(path: string, x: number, y: number): [number, number, number, number] {
  const image = PNG.sync.read(readFileSync(path));
  const index = (y * image.width + x) * 4;
  return [
    image.data[index] ?? 0,
    image.data[index + 1] ?? 0,
    image.data[index + 2] ?? 0,
    image.data[index + 3] ?? 0,
  ];
}

describe("Android adaptive icon", () => {
  test("uses a branded dark tile and a padded foreground inside the adaptive safe zone", () => {
    const config = JSON.parse(readFileSync("apps/mobile/app.json", "utf8")) as {
      expo: {
        android: {
          icon: string;
          adaptiveIcon: {
            foregroundImage: string;
            monochromeImage?: string;
            backgroundColor: string;
          };
        };
      };
    };
    const android = config.expo.android;
    const adaptiveIcon = config.expo.android.adaptiveIcon;
    expect(android.icon).toBe("./assets/cybara-android.png");
    expect(adaptiveIcon.foregroundImage).not.toBe("./assets/cybara.png");
    expect(adaptiveIcon.monochromeImage).toBeUndefined();
    expect(adaptiveIcon.backgroundColor).toBe("#071016");

    const foregroundBounds = alphaBounds(
      `apps/mobile/${adaptiveIcon.foregroundImage.replace(/^\.\//, "")}`
    );
    expect(foregroundBounds.width).toBe(1024);
    expect(foregroundBounds.height).toBe(1024);
    expect(foregroundBounds.left).toBeGreaterThanOrEqual(190);
    expect(foregroundBounds.top).toBeGreaterThanOrEqual(190);
    expect(foregroundBounds.right).toBeLessThanOrEqual(834);
    expect(foregroundBounds.bottom).toBeLessThanOrEqual(834);

    const legacyPath = `apps/mobile/${android.icon.replace(/^\.\//, "")}`;
    const legacyBounds = alphaBounds(legacyPath);
    expect(legacyBounds.width).toBe(1024);
    expect(legacyBounds.height).toBe(1024);
    expect(pixel(legacyPath, 0, 0)[3]).toBe(0);
    expect(pixel(legacyPath, 512, 0)[3]).toBeGreaterThan(0);
    expect(pixel(legacyPath, 128, 512)).toEqual([7, 16, 22, 255]);
  });
});
