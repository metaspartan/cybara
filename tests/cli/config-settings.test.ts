import { describe, expect, test } from "bun:test";
import {
  accessibilityConfigLines,
  buildCliConfigPatch,
  parseCliConfigValue,
} from "../../src/cli/commands/config";

describe("CLI settings configuration", () => {
  test("parses primitive and structured values", () => {
    expect(parseCliConfigValue("true")).toBe(true);
    expect(parseCliConfigValue("false")).toBe(false);
    expect(parseCliConfigValue("null")).toBeNull();
    expect(parseCliConfigValue("42.5")).toBe(42.5);
    expect(parseCliConfigValue('{"enabled":true}')).toEqual({ enabled: true });
    expect(parseCliConfigValue('["one","two"]')).toEqual(["one", "two"]);
    expect(parseCliConfigValue("comfortable")).toBe("comfortable");
    expect(() => parseCliConfigValue("{broken")).toThrow("Config JSON value is invalid");
  });

  test("updates nested settings without dropping sibling values", () => {
    const config = {
      chat_appearance: {
        fontSize: "standard",
        highContrast: false,
        reduceMotion: true,
      },
    };

    expect(buildCliConfigPatch(config, "chat_appearance.highContrast", true)).toEqual({
      chat_appearance: {
        fontSize: "standard",
        highContrast: true,
        reduceMotion: true,
      },
    });
    expect(config.chat_appearance.highContrast).toBe(false);
  });

  test("rejects unsafe or malformed nested keys", () => {
    for (const key of [
      "",
      "chat_appearance.__proto__.enabled",
      "constructor.value",
      "chat appearance.fontSize",
      "a.b.c.d.e.f.g.h.i",
    ]) {
      expect(() => buildCliConfigPatch({}, key, true)).toThrow("Config key is invalid");
    }
  });

  test("summarizes normalized accessibility values", () => {
    expect(
      accessibilityConfigLines({
        chat_appearance: {
          fontSize: "large",
          codeFontSize: "compact",
          lineSpacing: "spacious",
          underlineLinks: true,
          reduceMotion: true,
          reduceTransparency: true,
          highContrast: true,
        },
      })
    ).toEqual([
      "chat text size: large",
      "code text size: compact",
      "line spacing: spacious",
      "underline links: on",
      "reduce motion: on",
      "reduce transparency: on",
      "increase contrast: on",
    ]);
  });
});
