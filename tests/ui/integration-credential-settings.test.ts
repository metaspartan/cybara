import { describe, expect, test } from "bun:test";

describe("integration credential settings UI", () => {
  test("surfaces Smithery in MCP and Voyage in Memory through one secure field", async () => {
    const component = await Bun.file(
      "ui/src/components/settings/ManagedCredentialField.tsx"
    ).text();
    const mcp = await Bun.file("ui/src/pages/MCPServers.tsx").text();
    const memory = await Bun.file("ui/src/pages/settings/MemoryBehaviorSettings.tsx").text();
    const api = await Bun.file("ui/src/lib/api.ts").text();

    expect(component).toContain('type="password"');
    expect(component).toContain("Managed by");
    expect(component).toContain("Clear");
    expect(component).not.toContain("credential.secret");
    expect(mcp).toContain('credentialId="smithery"');
    expect(mcp).toContain("Smithery registry");
    expect(memory).toContain('credentialId="voyage"');
    expect(memory).toContain("Voyage AI embeddings");
    expect(api).toContain('fetchApi<IntegrationCredentialsStatus>("/integration-credentials")');
  });
});
