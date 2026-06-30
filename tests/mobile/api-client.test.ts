import { describe, expect, test } from "bun:test";
import { CybaraMobileApi } from "../../apps/mobile/src/lib/api";
import type { GatewayProfile } from "../../apps/mobile/src/lib/connection";

const profile: GatewayProfile = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:4269",
  apiKey: "cybara_mobile_test",
  createdAt: "2026-06-30T00:00:00.000Z",
};

describe("mobile API client", () => {
  test("sends bearer auth to gateway requests", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("authorization") });
      return new Response(JSON.stringify({ status: "healthy", uptime: 1, timestamp: "now" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await api.health();
      expect(calls).toEqual([
        {
          url: "http://127.0.0.1:4269/api/health",
          auth: "Bearer cybara_mobile_test",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads a broad feature summary without failing when optional surfaces are unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health") {
        return Response.json({ status: "healthy", uptime: 12, timestamp: "now" });
      }
      if (path === "/api/sessions") {
        return Response.json([{ id: "s1", title: "Build", message_count: 3, updated_at: "now" }]);
      }
      if (path === "/api/agents") return Response.json([{ id: "a1", name: "Main" }]);
      if (path === "/api/providers") return Response.json([{ id: "p1", name: "Anthropic", provider: "anthropic" }]);
      if (path === "/api/config") return Response.json({ tool_approval_mode: "ask" });
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const summary = await new CybaraMobileApi(profile).featureSummary();
      expect(summary.health?.status).toBe("healthy");
      expect(summary.sessions).toHaveLength(1);
      expect(summary.agents).toHaveLength(1);
      expect(summary.providers).toHaveLength(1);
      expect(summary.channels).toEqual([]);
      expect(summary.config.tool_approval_mode).toBe("ask");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
