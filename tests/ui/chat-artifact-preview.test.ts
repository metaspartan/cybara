import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));

function readChatSource(): string {
  return readFileSync(chatPagePath, "utf8");
}

describe("Chat artifact preview wiring", () => {
  test("includes artifact tool intent formatting", () => {
    const source = readChatSource();
    expect(source).toContain('if (key === "artifacts" || key === "artifact")');
    expect(source).toContain("Listing session artifacts...");
    expect(source).toContain("Created ${artifactName}");
    expect(source).toContain("inferArtifactSummaries");
  });

  test("loads artifact content from session artifact API endpoint", () => {
    const source = readChatSource();
    expect(source).toContain("/api/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/");
    expect(source).toContain("parseArtifactSummaries(result?.availableArtifacts)");
    expect(source).toContain("View {artifactSummaries[0].fileName}");
    expect(source).toContain("Preview");
    expect(source).toContain("Loading artifact...");
  });
});
