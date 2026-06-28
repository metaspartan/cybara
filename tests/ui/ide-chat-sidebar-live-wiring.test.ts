import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ideChatPanelSourcePath = join(process.cwd(), "ui", "src", "pages", "ide", "IDEChatPanel.tsx");
const ideActivityHelpersSourcePath = join(
  process.cwd(),
  "ui",
  "src",
  "pages",
  "ide",
  "ideActivityHelpers.ts"
);

function readIdeChatPanelSource(): string {
  return readFileSync(ideChatPanelSourcePath, "utf8");
}

function readIdeActivityHelpersSource(): string {
  return readFileSync(ideActivityHelpersSourcePath, "utf8");
}

describe("IDE chat sidebar live wiring", () => {
  test("uses websocket status stream with optimistic session ids for IDE runs", () => {
    const source = readIdeChatPanelSource();
    expect(source).toContain("connectStatusStream");
    expect(source).toContain("const requestSessionId = sessionId || crypto.randomUUID();");
    expect(source).toContain("void hydrateSessionStatus(sessionId);");
    expect(source).toContain(
      "const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([])"
    );
    expect(source).toContain(
      "const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);"
    );
  });

  test("renders a live working timeline and stop control in IDE chat", () => {
    const source = readIdeChatPanelSource();
    expect(source).toContain("const showWorkingTimeline =");
    expect(source).toContain("<IdeLiveActivityTimeline");
    expect(source).toContain("status={liveStatus}");
    expect(source).toContain("currentStep={liveCurrentStep}");
    expect(source).toContain("const handleStopActive = useCallback(async () => {");
    expect(source).toContain("await stopAgent.mutateAsync(targetAgentId);");
  });

  test("renders assistant markdown and preserves multiline tool output cards", () => {
    const panelSource = readIdeChatPanelSource();
    const helpersSource = readIdeActivityHelpersSource();
    expect(panelSource).toContain(
      "<ReactMarkdown remarkPlugins={[remarkGfm]} components={ideMarkdownComponents}>"
    );
    expect(helpersSource).toContain('const normalized = value.replace(/\\r\\n/g, "\\n").trim();');
    expect(helpersSource).toContain("[output truncated]");
    expect(panelSource).toContain("max-h-52 overflow-auto rounded border border-white/10 bg-[#06060b]");
  });
});
