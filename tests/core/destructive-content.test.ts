import { describe, expect, test } from "bun:test";
import {
  containsRootDestructiveCommand,
  redactRootDestructiveCommands,
} from "../../src/core/destructive-content";

describe("destructive content detection", () => {
  test("detects executable root deletion and fork-bomb payloads", () => {
    expect(containsRootDestructiveCommand("sudo rm -rf /")).toBe(true);
    expect(containsRootDestructiveCommand("rm -fr / ")).toBe(true);
    expect(containsRootDestructiveCommand("Do not run `sudo rm -rf /`.")).toBe(true);
    expect(containsRootDestructiveCommand(":(){ :|:& };:")).toBe(true);
  });

  test("allows paraphrases and ordinary removal commands", () => {
    expect(
      containsRootDestructiveCommand("a command that recursively deletes the root filesystem")
    ).toBe(false);
    expect(containsRootDestructiveCommand("rm -rf ./dist")).toBe(false);
    expect(containsRootDestructiveCommand("rm -rf /home/example")).toBe(false);
  });

  test("redacts executable payloads without changing surrounding text", () => {
    expect(redactRootDestructiveCommands("Never run `sudo rm -rf /`. Continue safely.")).toEqual({
      content: "Never run `[redacted destructive command]`. Continue safely.",
      redactions: 1,
    });
  });
});
