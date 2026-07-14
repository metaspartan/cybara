import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const uiSrc = fileURLToPath(new URL("../../ui/src", import.meta.url));
const read = (rel: string) => readFileSync(`${uiSrc}/${rel}`, "utf8");
const cli = readFileSync(fileURLToPath(new URL("../../src/cli.tsx", import.meta.url)), "utf8");

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

  test("desktop gateway failures replace the indefinite setup spinner", () => {
    expect(app).toContain("readGatewayStartupStatus");
    expect(app).toContain('gatewayStartup?.phase === "failed"');
    expect(app).toContain("<GatewayStartupFailure");
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

describe("Onboarding provider and agent setup", () => {
  const setup = read("pages/Setup.tsx");
  const oauth = read("hooks/useProviderOAuth.ts");

  test("never creates the generic default agent", () => {
    expect(setup).toContain("useCreateAgent");
    expect(setup).not.toContain("useCreateDefaultAgent");
    expect(setup).not.toContain("/agents/default");
    expect(setup).toContain("provider_id: configuredProvider.id");
    const setupWizard = cli.slice(cli.indexOf("const SetupWizard"), cli.indexOf("const TUIApp"));
    expect(setupWizard).not.toContain("/api/agents/default");
    expect(setupWizard).not.toContain("Create Default Agent");
  });

  test("commits setup status before replacing the onboarding route", () => {
    expect(setup).toContain("commitSetupComplete");
    expect(setup).toContain("queryClient.setQueryData(key, value)");
    expect(setup).toContain('navigate("/", { replace: true })');
  });

  test("does not duplicate an agent when setup completion is retried", () => {
    expect(setup).toContain("if (!agentCreated)");
    expect(setup).toContain("setAgentCreated(true)");
  });

  test("connects OAuth providers during onboarding and stores returned credentials", () => {
    expect(setup).toContain("await oauth.connect()");
    expect(setup).toContain("access_token: oauthCredentials?.access_token");
    expect(setup).toContain("refresh_token: oauthCredentials?.refresh_token");
    expect(oauth).toContain('apiFetch("/api/providers/oauth/device-code"');
    expect(oauth).toContain('apiFetch("/api/providers/oauth/poll"');
    expect(oauth).toContain('apiFetch("/api/providers/oauth/start"');
    expect(oauth).toContain('apiFetch("/api/providers/oauth/callback-status"');
    expect(cli).toContain("connectCliProviderOAuth");
    expect(cli).toContain('provider.authType === "oauth"');
    expect(cli).toContain("access_token: credentials?.accessToken");
  });

  test("distinguishes pasted access tokens from API keys", () => {
    expect(setup).toContain('provider.authType === "token"');
    expect(setup).toContain('title: "Enter Access Token"');
    expect(setup).toContain('placeholder: "Paste your access token"');
  });

  test("credential-free providers resolve their own name instead of stale selection state", () => {
    expect(setup).toContain(
      "availableProviders?.find((provider) => provider.id === providerId)?.name || providerId"
    );
    expect(setup).not.toContain("name: selectedProvider?.name || providerId");
  });

  test("uses the regular configured-provider model discovery contract", () => {
    expect(setup).toContain("useProviderModels(configuredProvider?.id)");
    expect(setup).toContain("discoveredModels");
    expect(setup).toContain("model.model_id");
    expect(setup).not.toContain("selectedProvider?.models || []");
  });

  test("relies on setup status instead of polling full resource lists", () => {
    expect(setup).not.toContain("useProviders()");
    expect(setup).not.toContain("useAgents()");
    expect(setup).not.toContain("providersLoading");
    expect(setup).not.toContain("agentsLoading");
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
