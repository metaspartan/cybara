import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  getIntegrationCredential,
  getIntegrationCredentialsStatus,
  updateIntegrationCredentials,
} from "../../src/core/integration-credentials";
import { isSealedSecret } from "../../src/core/secret-storage";

afterEach(() => {
  config.set("integration_credentials", null);
});

describe("integration credentials", () => {
  test("seals stored credentials and resolves them for their runtime consumers", () => {
    const status = updateIntegrationCredentials(
      { credentials: { smithery: "smithery-secret", voyage: "voyage-secret" } },
      {}
    );

    expect(status.credentials).toEqual([
      {
        id: "smithery",
        label: "Smithery",
        envVar: "SMITHERY_API_KEY",
        configured: true,
        source: "stored",
      },
      {
        id: "voyage",
        label: "Voyage AI",
        envVar: "VOYAGE_API_KEY",
        configured: true,
        source: "stored",
      },
    ]);

    const stored = config.get<{ credentials: Record<string, string> }>("integration_credentials");
    expect(stored?.credentials.smithery).not.toContain("smithery-secret");
    expect(stored?.credentials.voyage).not.toContain("voyage-secret");
    expect(isSealedSecret(stored?.credentials.smithery)).toBe(true);
    expect(isSealedSecret(stored?.credentials.voyage)).toBe(true);
    expect(getIntegrationCredential("smithery", {})).toBe("smithery-secret");
    expect(getIntegrationCredential("voyage", {})).toBe("voyage-secret");
  });

  test("keeps environment credentials authoritative and immutable", () => {
    updateIntegrationCredentials({ credentials: { voyage: "stored-voyage" } }, {});
    const env = { VOYAGE_API_KEY: "environment-voyage" };

    expect(getIntegrationCredential("voyage", env)).toBe("environment-voyage");
    expect(
      getIntegrationCredentialsStatus(env).credentials.find((item) => item.id === "voyage")
    ).toMatchObject({ configured: true, source: "env" });
    expect(() =>
      updateIntegrationCredentials({ credentials: { voyage: "replacement" } }, env)
    ).toThrow("VOYAGE_API_KEY is set in the gateway environment");
  });

  test("clears stored credentials without exposing them", () => {
    updateIntegrationCredentials({ credentials: { smithery: "smithery-secret" } }, {});
    const status = updateIntegrationCredentials({ credentials: { smithery: null } }, {});

    expect(status.credentials.find((item) => item.id === "smithery")).toMatchObject({
      configured: false,
      source: "none",
    });
    expect(getIntegrationCredential("smithery", {})).toBeUndefined();
  });

  test("rejects unknown credential names and malformed values", () => {
    expect(() =>
      updateIntegrationCredentials(
        { credentials: { unknown: "secret" } as Record<string, string> },
        {}
      )
    ).toThrow("Unsupported integration credential");
    expect(() =>
      updateIntegrationCredentials({ credentials: { voyage: { value: "secret" } } }, {})
    ).toThrow("Integration API keys must be strings");
  });
});
