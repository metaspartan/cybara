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

describe("Android adaptive icon", () => {
  test("uses padded foreground and monochrome assets inside the adaptive safe zone", () => {
    const config = JSON.parse(readFileSync("apps/mobile/app.json", "utf8")) as {
      expo: {
        android: {
          adaptiveIcon: {
            foregroundImage: string;
            monochromeImage: string;
          };
        };
      };
    };
    const adaptiveIcon = config.expo.android.adaptiveIcon;
    expect(adaptiveIcon.foregroundImage).not.toBe("./assets/cybara.png");
    expect(adaptiveIcon.monochromeImage).toBe("./assets/cybara-adaptive-monochrome.png");

    for (const relativePath of [adaptiveIcon.foregroundImage, adaptiveIcon.monochromeImage]) {
      const bounds = alphaBounds(`apps/mobile/${relativePath.replace(/^\.\//, "")}`);
      expect(bounds.width).toBe(1024);
      expect(bounds.height).toBe(1024);
      expect(bounds.left).toBeGreaterThanOrEqual(190);
      expect(bounds.top).toBeGreaterThanOrEqual(190);
      expect(bounds.right).toBeLessThanOrEqual(834);
      expect(bounds.bottom).toBeLessThanOrEqual(834);
    }
  });
});
