import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ideChatPanelSourcePath = join(process.cwd(), "ui", "src", "pages", "ide", "IDEChatPanel.tsx");
const ideChatStatusSourcePath = join(
  process.cwd(),
  "ui",
  "src",
  "pages",
  "ide",
  "IDEChatStatus.tsx"
);
const ideChatRoutingSourcePath = join(
  process.cwd(),
  "ui",
  "src",
  "pages",
  "ide",
  "useIDEChatRouting.ts"
);
const ideActivityHelpersSourcePath = join(
  process.cwd(),
  "ui",
  "src",
  "pages",
  "ide",
  "ideActivityHelpers.ts"
);
const chatAgentControlsSourcePath = join(
  process.cwd(),
  "ui",
  "src",
  "pages",
  "chat",
  "ChatAgentControls.tsx"
);

function readIdeChatPanelSource(): string {
  return [ideChatPanelSourcePath, ideChatStatusSourcePath, ideChatRoutingSourcePath]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function readIdeActivityHelpersSource(): string {
  return readFileSync(ideActivityHelpersSourcePath, "utf8");
}

function readChatAgentControlsSource(): string {
  return readFileSync(chatAgentControlsSourcePath, "utf8");
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
    expect(source).toContain('const showWorkingTimeline = isSending || liveStatus !== "idle";');
    expect(source).toContain('const sessionCurrentlyActive = liveStatus !== "idle";');
    expect(source).toContain('if (payload.status === "error") {');
    expect(source).toContain('setLiveStatus("idle");');
    expect(source).toContain("<IdeLiveActivityTimeline");
    expect(source).toContain("status={liveStatus}");
    expect(source).toContain("currentStep={liveCurrentStep}");
    expect(source).toContain("const handleStopActive = useCallback(async () => {");
    expect(source).toContain("await chatApi.stopSession(sessionId)");
    expect(source).toContain("await chatApi.getSession(sessionId)");
    expect(source).not.toContain("stopAgent.mutateAsync");
  });

  test("reuses rich chat rendering and preserves multiline tool output cards", () => {
    const panelSource = readIdeChatPanelSource();
    const helpersSource = readIdeActivityHelpersSource();
    expect(panelSource).toContain("<MessageContent");
    expect(panelSource).toContain("<ChatImageLightbox");
    expect(helpersSource).toContain('const normalized = value.replace(/\\r\\n/g, "\\n").trim();');
    expect(helpersSource).toContain("[output truncated]");
    expect(panelSource).toContain(
      "max-h-52 overflow-auto rounded border border-white/10 bg-[#06060b]"
    );
  });

  test("uses the shared main chat composer controls for context and routing", () => {
    const panelSource = readIdeChatPanelSource();
    const controlsSource = readChatAgentControlsSource();
    expect(panelSource).toContain("<IDEChatComposer");
    expect(panelSource).toContain("useUpdateAgentReasoning");
    expect(panelSource).toContain("providerPlansApi.status()");
    expect(panelSource).toContain("setSessionContextUsage(response.data.contextUsage ?? null)");
    expect(panelSource).toContain("useModelRouter");
    expect(panelSource).toContain("MODEL_ROUTER_SELECTOR_VALUE");
    expect(controlsSource).toContain("ContextUsageRing");
    expect(controlsSource).toContain("Model Router");
  });
});
