import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const uiSrc = fileURLToPath(new URL("../../ui/src", import.meta.url));
const read = (rel: string) => readFileSync(`${uiSrc}/${rel}`, "utf8");

describe("onboarding boot: no shell flash + full-screen spinner", () => {
  const app = read("App.tsx");

  test("Sidebar renders inside SetupGuard (not before it), so the shell doesn't flash", () => {
    // The wildcard route must wrap Sidebar within SetupGuard.
    const guardBlock = app.slice(app.indexOf("<SetupGuard>"), app.indexOf("</SetupGuard>"));
    expect(guardBlock).toContain("<Sidebar />");
    // Sidebar must NOT be rendered as a sibling before SetupGuard in the route element.
    expect(app).not.toMatch(/<Sidebar \/>\s*<SetupGuard>/);
  });

  test("the setup loading state is a full-screen centered spinner", () => {
    expect(app).toContain("fixed inset-0");
    expect(app).toContain("animate-spin");
  });

  test("app boot gates on lightweight setup status instead of full agents/providers", () => {
    const guardBlock = app.slice(
      app.indexOf("function SetupGuard"),
      app.indexOf("function MainContent")
    );
    expect(guardBlock).toContain("setupApi.status()");
    expect(guardBlock).not.toContain("useAgents()");
    expect(guardBlock).not.toContain("useProviders()");
  });
});

describe("Agents: ready-on-demand chat routing + default model", () => {
  const agents = read("pages/Agents.tsx");

  test("agent identities link into the primary chat without activation controls", () => {
    expect(agents).toContain("buildAgentChatPath(agent.id)");
    expect(agents).toContain("Ready on demand");
    expect(agents).not.toContain("useStartAgent");
    expect(agents).not.toContain("useStopAgent");
    expect(agents).not.toContain("ChatModal");
    expect(agents).not.toContain("onToggleStatus");
  });

  test("default model selector persists via config", () => {
    expect(agents).toContain("settingsApi.updateConfig({ default_model:");
    expect(agents).toContain("Default model");
  });
});

describe("Settings: system prompt preview wiring", () => {
  const settings = read("pages/settings/SystemPromptSection.tsx");

  test("renders the preview from the API and has a graceful fallback", () => {
    expect(settings).toContain("useSystemPromptPreview");
    expect(settings).toContain("preview?.preview");
    expect(settings).toContain("No preview available");
  });

  test("prompt features use switch controls instead of checkbox inputs", () => {
    const featuresBlock = settings.slice(
      settings.indexOf("Prompt Features"),
      settings.indexOf("Custom System Prompt")
    );
    expect(featuresBlock).toContain("<Switch");
    expect(featuresBlock).toContain("onChange={(checked)");
    expect(featuresBlock).not.toContain('type="checkbox"');
  });
});
