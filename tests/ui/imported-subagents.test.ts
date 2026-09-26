import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

test("imported transcripts stay in the native parent panel without fake session nesting", () => {
  const panel = readFileSync(
    resolve(import.meta.dir, "../../ui/src/pages/chat/SubagentDetailPanel.tsx"),
    "utf8"
  );
  const sessions = readFileSync(
    resolve(import.meta.dir, "../../ui/src/pages/Sessions.tsx"),
    "utf8"
  );
  expect(panel).toContain("Subagent transcript");
  expect(panel).toContain("/messages?sessionId=");
  expect(panel).toContain("!subagent.imported");
  expect(sessions).not.toContain("subChatsByParent");
  expect(sessions).toContain("filteredSessions.map(renderSessionCard)");
});
