import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const chatModelPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/chatModel.ts", import.meta.url)
);

function readChatSource(): string {
  return readFileSync(chatPagePath, "utf8") + readFileSync(chatModelPath, "utf8");
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
    expect(source).toContain("tryParseJsonRecord(tool.result)");
    expect(source).toContain(
      "<ArtifactSummaryCard artifacts={artifactSummary} onOpenArtifact={onOpenArtifact} />"
    );
    expect(source).not.toContain("View {artifactSummaries[0].fileName}");
    expect(source).not.toContain("Preview {artifactSummaries[0].fileName}");
    expect(source).toContain("Loading artifact...");
  });

  test("renders artifact viewer as a full chat-area panel with markdown/raw toggle", () => {
    const source = readChatSource();
    expect(source).toContain("function ArtifactViewerPanel");
    expect(source).toContain("Back to chat");
    expect(source).toContain("Markdown");
    expect(source).toContain("Raw");
    expect(source).toContain("{artifactViewerTarget ? (");
    expect(source).toContain("onOpenArtifact={openArtifactViewer}");
  });
});
