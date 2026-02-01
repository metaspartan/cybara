// API Routes Tests - Integration tests for the HTTP API
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const BASE_URL = "http://localhost:4269";

// Helper to make API requests
async function api(method: string, path: string, body?: unknown) {
    const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    return {
        status: response.status,
        data: await response.json().catch(() => null),
    };
}

describe("API Health & Status", () => {
    test("GET /api/health should return healthy status", async () => {
        const { status, data } = await api("GET", "/api/health");
        expect(status).toBe(200);
        expect(data.status).toBe("healthy");
        expect(data.timestamp).toBeDefined();
        expect(data.uptime).toBeDefined();
        expect(data.version).toBe("1.0.0");
    });

    test("GET /api/health should include system checks", async () => {
        const { data } = await api("GET", "/api/health");
        expect(data.checks.database).toBeDefined();
        expect(data.checks.agents).toBeDefined();
        expect(data.checks.providers).toBeDefined();
        expect(data.checks.memory).toBeDefined();
    });
});

describe("Agents API", () => {
    test("GET /api/agents should return array", async () => {
        const { status, data } = await api("GET", "/api/agents");
        expect(status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
    });

    test("POST /api/agents should create a new agent", async () => {
        const newAgent = {
            name: `test-agent-${Date.now()}`,
            type: "basic",
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
        };
        const { status, data } = await api("POST", "/api/agents", newAgent);
        expect(status).toBe(200);
        expect(data.name).toBe(newAgent.name);
        expect(data.id).toBeDefined();
    });
});

describe("Providers API", () => {
    test("GET /api/providers should return array", async () => {
        const { status, data } = await api("GET", "/api/providers");
        expect(status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
    });

    test("GET /api/providers/health should return provider health", async () => {
        const { status, data } = await api("GET", "/api/providers/health");
        expect(status).toBe(200);
        expect(typeof data).toBe("object");
    });
});

describe("Channels API", () => {
    test("GET /api/channels should return array", async () => {
        const { status, data } = await api("GET", "/api/channels");
        expect(status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
    });
});

describe("Skills API", () => {
    test("GET /api/skills should return skills array", async () => {
        const { status, data } = await api("GET", "/api/skills");
        expect(status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
    });
});

describe("MCP Servers API", () => {
    test("GET /api/mcp/servers should return object", async () => {
        const { status, data } = await api("GET", "/api/mcp/servers");
        expect(status).toBe(200);
        expect(typeof data).toBe("object");
    });
});

describe("Tools API", () => {
    test("GET /api/tools should return tools", async () => {
        const { status, data } = await api("GET", "/api/tools");
        expect(status).toBe(200);
        expect(typeof data).toBe("object");
    });
});

describe("Session API", () => {
    test("GET /api/sessions should return array", async () => {
        const { status, data } = await api("GET", "/api/sessions");
        expect(status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
    });
});

describe("Metrics API", () => {
    test("GET /api/metrics should return metrics", async () => {
        const { status, data } = await api("GET", "/api/metrics");
        expect(status).toBe(200);
        expect(typeof data).toBe("object");
        // Should contain expected properties
        expect(data).toHaveProperty("memory");
        expect(data).toHaveProperty("uptime");
    });
});

describe("Channel Security API", () => {
    let testChannelId: string;

    beforeAll(async () => {
        // Create a test channel for security tests
        const { data } = await api("POST", "/api/channels", {
            name: `security-test-${Date.now()}`,
            type: "telegram",
            config: { bot_token: "test-token" },
        });
        testChannelId = data?.id;
    });

    test("GET /api/channels/:id/pairings should return pairings", async () => {
        if (!testChannelId) return;
        const { status, data } = await api("GET", `/api/channels/${testChannelId}/pairings`);
        expect(status).toBe(200);
        expect(Array.isArray(data.pairings)).toBe(true);
        expect(typeof data.pendingCount).toBe("number");
        expect(data.config).toBeDefined();
    });

    test("GET /api/channels/:id/allowed-senders should return senders", async () => {
        if (!testChannelId) return;
        const { status, data } = await api("GET", `/api/channels/${testChannelId}/allowed-senders`);
        expect(status).toBe(200);
        expect(Array.isArray(data.senders)).toBe(true);
    });

    test("POST /api/channels/:id/allowed-senders should add sender", async () => {
        if (!testChannelId) return;
        const senderId = `test-sender-${Date.now()}`;
        const { status, data } = await api("POST", `/api/channels/${testChannelId}/allowed-senders`, { senderId });
        expect(status).toBe(200);
        expect(data.success).toBe(true);
    });

    test("PUT /api/channels/:id/security should update security config", async () => {
        if (!testChannelId) return;
        const { status, data } = await api("PUT", `/api/channels/${testChannelId}/security`, {
            dm_policy: "allowlist",
        });
        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.config.dm_policy).toBe("allowlist");
    });

    afterAll(async () => {
        // Cleanup test channel
        if (testChannelId) {
            await api("DELETE", `/api/channels/${testChannelId}`);
        }
    });
});
