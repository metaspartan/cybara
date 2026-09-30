import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const panelPath = fileURLToPath(
  new URL("../../ui/src/pages/settings/DecisionModelSettings.tsx", import.meta.url)
);
const settingsPath = fileURLToPath(new URL("../../ui/src/pages/Settings.tsx", import.meta.url));
const apiPath = fileURLToPath(new URL("../../ui/src/lib/api.ts", import.meta.url));

const panel = readFileSync(panelPath, "utf8");
const settings = readFileSync(settingsPath, "utf8");
const api = readFileSync(apiPath, "utf8");

describe("decision model settings panel wiring", () => {
  test("is imported and rendered in the safety settings section", () => {
    expect(settings).toContain(
      'import { DecisionModelSettings } from "./settings/DecisionModelSettings"'
    );
    expect(settings).toContain("<DecisionModelSettings />");
  });

  test("exposes a model picker, endpoint field and api key field", () => {
    expect(panel).toContain('aria-label="Decision model"');
    expect(panel).toContain('placeholder="https://api.typesafe.ai/v1/systemone"');
    expect(panel).toContain('type="password"');
  });

  test("offers the discovered decision models as options", () => {
    expect(panel).toContain("settings.models.map");
    expect(panel).toContain("{model.id}");
  });

  test("never renders the stored api key into a visible value", () => {
    expect(panel).toContain("settings.has_api_key");
    expect(panel).not.toMatch(/value=\{settings\.api_key\}/);
  });

  test("tells the user the key is stored encrypted", () => {
    expect(panel).toContain("Stored encrypted");
  });

  test("states that a decision model does not act or approve", () => {
    expect(panel).toContain("never replaces your primary model");
  });

  test("saves through the decision api and clears the key field afterwards", () => {
    expect(panel).toContain("decisionApi.update(update)");
    expect(panel).toContain('setApiKey("")');
  });

  test("only sends the api key when the user typed one", () => {
    expect(panel).toContain("if (apiKey.trim()) update.api_key = apiKey.trim()");
  });

  test("tracks the model in its own state so unsaved edits are not lost", () => {
    expect(panel).toContain('const [model, setModel] = useState("")');
    expect(panel).toContain("base_url: baseUrl, model }");
  });

  test("exposes a typed client for the decisions settings endpoint", () => {
    expect(api).toContain("export const decisionApi = {");
    expect(api).toContain('"/settings/decisions"');
    expect(api).toContain("export interface DecisionSettings {");
  });
});
