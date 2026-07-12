import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("shared channel handlers route management commands before agent chat", () => {
  const source = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const commandIndex = source.indexOf("handleSharedChannelManagementCommand(message");
  const chatIndex = source.indexOf("const response = await handleChat({", commandIndex);
  expect(commandIndex).toBeGreaterThan(0);
  expect(chatIndex).toBeGreaterThan(commandIndex);
  expect(source).toContain("if (commandResponse !== null) return commandResponse;");
});
