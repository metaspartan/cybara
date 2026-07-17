import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { createRoutesFixture } from "./routes.fixture";

const fixture = createRoutesFixture();

describe("Skills API", () => {
  test("GET /api/skills should return skills array", async () => {
    const { status, data } = await fixture.api("GET", "/api/skills");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("skills category/status/registry endpoints should return shaped responses", async () => {
    const categories = await fixture.api("GET", "/api/skills/categories");
    expect(categories.status).toBe(200);
    expect(Array.isArray(categories.data)).toBe(true);

    const statusRes = await fixture.api("GET", "/api/skills/status");
    expect(statusRes.status).toBe(200);
    expect(Array.isArray(statusRes.data.skills)).toBe(true);
    expect(typeof statusRes.data.summary.total).toBe("number");

    const registrySearch = await fixture.api("GET", "/api/skills/registry/search");
    expect(registrySearch.status).toBe(200);
    expect(Array.isArray(registrySearch.data.skills)).toBe(true);
    expect(Array.isArray(registrySearch.data.registries)).toBe(true);
  });

  test("POST /api/skills should create local skill", async () => {
    const skillSlug = `audit-skill-${Date.now()}`;
    const { status, data } = await fixture.api("POST", "/api/skills", {
      name: skillSlug,
      slug: skillSlug,
      description: "Audit test skill",
      content: `# ${skillSlug}\n\nA test skill created by integration tests.`,
    });

    expect(status).toBe(200);
    expect(data.name).toBeDefined();

    await fixture.api("DELETE", `/api/skills/${skillSlug}`);
  });

  test("POST /api/skills/:name/execute should run builtin calc skill", async () => {
    const { status, data } = await fixture.api("POST", "/api/skills/calc/execute", {
      expression: "2+2*5",
    });
    expect(status).toBe(200);
    expect(data.expression).toBe("2+2*5");
    expect(data.result).toBe(12);
    expect(data.formatted).toBe("12");
  });
});

describe("MCP Servers API", () => {
  test("GET /api/mcp/servers should return array", async () => {
    const { status, data } = await fixture.api("GET", "/api/mcp/servers");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/mcp/tools should return array", async () => {
    const { status, data } = await fixture.api("GET", "/api/mcp/tools");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("MCP create/get/update/start/stop/delete lifecycle should be wired", async () => {
    const createRes = await fixture.api("POST", "/api/mcp", {
      name: `routes-mcp-${Date.now()}`,
      command: "echo",
      args: "hello",
      enabled: true,
    });
    expect(createRes.status).toBe(200);
    expect(typeof createRes.data.id).toBe("string");
    const mcpId = createRes.data.id as string;

    const getRes = await fixture.api("GET", `/api/mcp/${mcpId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(mcpId);
    expect(typeof getRes.data.status).toBe("string");

    const updateRes = await fixture.api("PUT", `/api/mcp/${mcpId}`, {
      name: `routes-mcp-updated-${Date.now()}`,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.success).toBe(true);

    const startRes = await fixture.api("POST", `/api/mcp/${mcpId}/start`);
    expect(startRes.status).toBe(200);
    expect(startRes.data.success).toBe(false);
    expect(typeof startRes.data.error).toBe("string");

    const stopRes = await fixture.api("POST", `/api/mcp/${mcpId}/stop`);
    expect(stopRes.status).toBe(200);
    expect(stopRes.data.success).toBe(true);

    const deleteRes = await fixture.api("DELETE", `/api/mcp/${mcpId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.success).toBe(true);
  });

  test("remote MCP creation persists HTTPS transport without exposing credentials", async () => {
    const createRes = await fixture.api("POST", "/api/mcp", {
      name: `routes-remote-mcp-${Date.now()}`,
      url: "https://example.com/mcp",
      authorization: "secret-token",
      enabled: true,
    });
    expect(createRes.status).toBe(200);
    expect(createRes.data.env).toBeUndefined();
    expect(createRes.data.hasCredentials).toBe(true);
    const id = createRes.data.id as string;

    const listRes = await fixture.api("GET", "/api/mcp");
    const listed = (listRes.data as Array<Record<string, unknown>>).find(
      (server) => server.id === id
    );
    expect(listed?.url).toBe("https://example.com/mcp");
    expect(listed?.transport).toBe("http");
    expect(listed?.hasCredentials).toBe(true);
    expect(listed?.env).toBeUndefined();

    const detailRes = await fixture.api("GET", `/api/mcp/${id}`);
    expect(detailRes.data.env).toBeUndefined();
    expect(detailRes.data.hasCredentials).toBe(true);

    const deleteRes = await fixture.api("DELETE", `/api/mcp/${id}`);
    expect(deleteRes.data.success).toBe(true);
  });
});

describe("MCP Registry API", () => {
  test("registry list/search/category/detail/install endpoints should be wired", async () => {
    const registriesRes = await fixture.api("GET", "/api/mcp/registry/registries");
    expect(registriesRes.status).toBe(200);
    expect(Array.isArray(registriesRes.data)).toBe(true);
    expect(registriesRes.data.length).toBeGreaterThan(0);

    const popularRes = await fixture.api("GET", "/api/mcp/registry/popular");
    expect(popularRes.status).toBe(200);
    expect(Array.isArray(popularRes.data)).toBe(true);
    expect(popularRes.data.length).toBeGreaterThan(0);

    const categoriesRes = await fixture.api("GET", "/api/mcp/registry/categories");
    expect(categoriesRes.status).toBe(200);
    expect(Array.isArray(categoriesRes.data)).toBe(true);
    expect(categoriesRes.data.length).toBeGreaterThan(0);

    const categoryRes = await fixture.api("GET", "/api/mcp/registry/category/core");
    expect(categoryRes.status).toBe(200);
    expect(Array.isArray(categoryRes.data)).toBe(true);
    expect(categoryRes.data.length).toBeGreaterThan(0);

    const searchRes = await fixture.api(
      "GET",
      "/api/mcp/registry/search?q=filesystem&registry=official"
    );
    expect(searchRes.status).toBe(200);
    expect(Array.isArray(searchRes.data)).toBe(true);

    const detailRes = await fixture.api("GET", "/api/mcp/registry/servers/mcp-filesystem");
    expect(detailRes.status).toBe(200);
    expect(detailRes.data.id).toBe("mcp-filesystem");

    const installRes = await fixture.api("POST", "/api/mcp/registry/install", {
      id: "mcp-filesystem",
      trustedAction: true,
    });
    expect(installRes.status).toBe(200);
    expect(installRes.data.success).toBe(true);
    expect(typeof installRes.data.id).toBe("string");
    const installedId = installRes.data.id as string;

    const cleanupRes = await fixture.api("DELETE", `/api/mcp/${installedId}`);
    expect(cleanupRes.status).toBe(200);
    expect(cleanupRes.data.success).toBe(true);
  });

  test("install endpoint should validate missing id/package", async () => {
    const untrusted = await fixture.api("POST", "/api/mcp/registry/install", {
      id: "mcp-filesystem",
    });
    expect(untrusted.status).toBe(200);
    expect(untrusted.data.success).toBe(false);
    expect(String(untrusted.data.error)).toContain("trustedAction=true");

    const res = await fixture.api("POST", "/api/mcp/registry/install", {
      trustedAction: true,
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(false);
    expect(typeof res.data.error).toBe("string");
  });
});

describe("Tools API", () => {
  test("GET /api/tools/builtin should return builtin tool definitions", async () => {
    const { status, data } = await fixture.api("GET", "/api/tools/builtin");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].name).toBe("string");
  });

  test("GET /api/tools should return tools", async () => {
    const { status, data } = await fixture.api("GET", "/api/tools");
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
  });

  test("GET /api/tools/dangerous returns policy and dangerous tool list", async () => {
    const { status, data } = await fixture.api("GET", "/api/tools/dangerous");
    expect(status).toBe(200);
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools).toContain("exec");
    expect(typeof data.policy).toBe("object");
    expect(typeof data.policy.enabled).toBe("boolean");
    expect(["audit", "block"]).toContain(data.policy.mode);
  });

  test("POST /api/tools/execute should validate missing/unknown tool names", async () => {
    const missingName = await fixture.api("POST", "/api/tools/execute", {});
    expect(missingName.status).toBe(400);
    expect(missingName.data.code).toBe("VALIDATION_ERROR");

    const unknownTool = await fixture.api("POST", "/api/tools/execute", {
      name: `missing-tool-${Date.now()}`,
      args: {},
    });
    expect(unknownTool.status).toBe(400);
    expect(unknownTool.data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/tools/execute supports optional context permission enforcement", async () => {
    const toolFile = join(fixture.testHome, `tool-permission-${Date.now()}.txt`);
    writeFileSync(toolFile, "permission-test", "utf8");

    const denied = await fixture.api("POST", "/api/tools/execute", {
      name: "read",
      args: { path: toolFile },
      context: {
        agentId: "api-tools-test",
        sessionId: "api-tools-session",
        permissions: ["net:fetch"],
        enforcePermissions: true,
      },
    });
    expect(denied.status).toBe(400);
    expect(denied.data.code).toBe("VALIDATION_ERROR");
    expect(String(denied.data.error || "")).toContain("Permission denied");

    const allowed = await fixture.api("POST", "/api/tools/execute", {
      name: "read",
      args: { path: toolFile },
      context: {
        agentId: "api-tools-test",
        sessionId: "api-tools-session",
        permissions: ["fs:read"],
        enforcePermissions: true,
      },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.data.content).toBe("permission-test");
  });

  test("POST /api/tools/execute confines file writes to the supplied workspace by default", async () => {
    const workspaceDir = mkdtempSync(join(fixture.testHome, "tool-workspace-"));
    const outsideDir = mkdtempSync(join(fixture.testHome, "tool-outside-"));
    try {
      const inside = join(workspaceDir, "notes.txt");
      const outside = join(outsideDir, "escape.txt");

      const insideWrite = await fixture.api("POST", "/api/tools/execute", {
        name: "write",
        args: { path: inside, content: "inside" },
        context: { agentId: "api-tools-workspace", workspaceDir },
      });
      expect(insideWrite.status).toBe(200);
      expect(insideWrite.data.success).toBe(true);

      const outsideWrite = await fixture.api("POST", "/api/tools/execute", {
        name: "write",
        args: { path: outside, content: "outside" },
        context: { agentId: "api-tools-workspace", workspaceDir },
      });
      expect(outsideWrite.status).toBe(400);
      expect(String(outsideWrite.data.error || "")).toContain("outside the configured workspace");
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("POST /api/tools/execute rejects symlink escapes from the supplied workspace", async () => {
    const workspaceDir = mkdtempSync(join(fixture.testHome, "tool-symlink-workspace-"));
    const outsideDir = mkdtempSync(join(fixture.testHome, "tool-symlink-outside-"));
    try {
      const outsideFile = join(outsideDir, "target.txt");
      const outsideFileLink = join(workspaceDir, "linked-target.txt");
      const outsideSubdir = join(outsideDir, "subdir");
      const outsideDirLink = join(workspaceDir, "linked-dir");
      writeFileSync(outsideFile, "outside", "utf8");
      mkdirSync(outsideSubdir, { recursive: true });
      symlinkSync(outsideFile, outsideFileLink);
      symlinkSync(outsideSubdir, outsideDirLink, "dir");

      const fileLinkWrite = await fixture.api("POST", "/api/tools/execute", {
        name: "write",
        args: { path: outsideFileLink, content: "overwrite through link" },
        context: { agentId: "api-tools-symlink", workspaceDir },
      });
      expect(fileLinkWrite.status).toBe(400);
      expect(String(fileLinkWrite.data.error || "")).toContain("outside the configured workspace");

      const parentLinkWrite = await fixture.api("POST", "/api/tools/execute", {
        name: "write",
        args: {
          path: join(outsideDirLink, "new-file.txt"),
          content: "escape through parent",
        },
        context: { agentId: "api-tools-symlink", workspaceDir },
      });
      expect(parentLinkWrite.status).toBe(400);
      expect(String(parentLinkWrite.data.error || "")).toContain(
        "outside the configured workspace"
      );
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("POST /api/tools/execute blocks dangerous tools when policy is enabled", async () => {
    const applyPolicy = await fixture.api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: true, mode: "block" },
    });
    expect(applyPolicy.status).toBe(200);

    const blocked = await fixture.api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo policy-blocked" },
      context: { agentId: "dangerous-policy-test" },
    });
    expect(blocked.status).toBe(400);
    expect(blocked.data.code).toBe("VALIDATION_ERROR");
    expect(String(blocked.data.error || "")).toContain("Dangerous tool 'exec' blocked by policy");

    // SECURITY: a client-supplied allowDangerousTools must NOT bypass the
    // policy — the server ignores it, so the dangerous tool stays blocked.
    const overrideIgnored = await fixture.api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo policy-allowed" },
      context: {
        agentId: "dangerous-policy-test",
        allowDangerousTools: true,
      },
    });
    expect(overrideIgnored.status).toBe(400);
    expect(String(overrideIgnored.data.error || "")).toContain(
      "Dangerous tool 'exec' blocked by policy"
    );

    const codeBlocked = await fixture.api("POST", "/api/tools/execute", {
      name: "execute_code",
      args: { code: "return 2 + 2" },
      context: { agentId: "dangerous-policy-test" },
    });
    expect(codeBlocked.status).toBe(400);
    expect(String(codeBlocked.data.error || "")).toContain(
      "Dangerous tool 'execute_code' blocked by policy"
    );

    const resetPolicy = await fixture.api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: false, mode: "audit" },
    });
    expect(resetPolicy.status).toBe(200);
  });

  test("POST /api/tools/execute requires approval for dangerous tools when tool approval mode is ask", async () => {
    const setAskMode = await fixture.api("PUT", "/api/config", {
      tool_approval_mode: "ask",
    });
    expect(setAskMode.status).toBe(200);

    const blocked = await fixture.api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo approval-required" },
      context: { agentId: "dangerous-approval-test" },
    });
    expect(blocked.status).toBe(400);
    expect(blocked.data.code).toBe("VALIDATION_ERROR");
    expect(String(blocked.data.error || "")).toContain("requires approval");

    // SECURITY: a client-supplied allowDangerousTools must NOT bypass the
    // approval gate — the server ignores it, so approval is still required.
    const overrideIgnored = await fixture.api("POST", "/api/tools/execute", {
      name: "exec",
      args: { command: "echo approval-override" },
      context: {
        agentId: "dangerous-approval-test",
        allowDangerousTools: true,
      },
    });
    expect(overrideIgnored.status).toBe(400);
    expect(String(overrideIgnored.data.error || "")).toContain("requires approval");

    const resetMode = await fixture.api("PUT", "/api/config", {
      tool_approval_mode: "always_allow",
    });
    expect(resetMode.status).toBe(200);
  });
});

describe("LSP API", () => {
  test("LSP status/languages/diagnostics/install-status endpoints should return shaped payloads", async () => {
    const lspMetricsBefore = fixture.countMetrics("lsp_operation");

    const statusRes = await fixture.api("GET", "/api/lsp/status");
    expect(statusRes.status).toBe(200);
    expect(typeof statusRes.data.status).toBe("string");
    expect(typeof statusRes.data.workspace).toBe("string");
    expect(Array.isArray(statusRes.data.supported)).toBe(true);
    expect(Array.isArray(statusRes.data.active)).toBe(true);
    expect(typeof statusRes.data.diagnosticsCount).toBe("number");

    const languagesRes = await fixture.api("GET", "/api/lsp/languages");
    expect(languagesRes.status).toBe(200);
    expect(Array.isArray(languagesRes.data.languages)).toBe(true);

    const diagnosticsRes = await fixture.api("GET", "/api/lsp/diagnostics");
    expect(diagnosticsRes.status).toBe(200);
    expect(Array.isArray(diagnosticsRes.data.files)).toBe(true);
    expect(typeof diagnosticsRes.data.total).toBe("number");

    const installStatusRes = await fixture.api("GET", "/api/lsp/install-status");
    expect(installStatusRes.status).toBe(200);
    expect(Array.isArray(installStatusRes.data.status)).toBe(true);
    expect(installStatusRes.data.status.length).toBeGreaterThan(0);

    const lspMetricsAfter = fixture.countMetrics("lsp_operation");
    expect(lspMetricsAfter).toBeGreaterThan(lspMetricsBefore);
  });

  test("LSP diagnostics file endpoint should validate missing path and support explicit file path", async () => {
    const missingRes = await fixture.api("GET", "/api/lsp/diagnostics/file");
    expect(missingRes.status).toBe(200);
    expect(missingRes.data.success).toBe(false);
    expect(typeof missingRes.data.error).toBe("string");

    const tsPath = join(fixture.testHome, `lsp-test-${Date.now()}.ts`);
    writeFileSync(tsPath, "const n: number = 1;\n", "utf8");

    const fileRes = await fixture.api(
      "GET",
      `/api/lsp/diagnostics/file?path=${encodeURIComponent(tsPath)}`
    );
    expect(fileRes.status).toBe(200);
    expect(fileRes.data.success).toBe(true);
    expect(fileRes.data.path).toBe(tsPath);
    expect(Array.isArray(fileRes.data.diagnostics)).toBe(true);
  });

  test("LSP install/uninstall endpoints should validate and reject unknown languages safely", async () => {
    const missingInstall = await fixture.api("POST", "/api/lsp/install", {});
    expect(missingInstall.status).toBe(200);
    expect(missingInstall.data.success).toBe(false);
    expect(typeof missingInstall.data.error).toBe("string");

    const unknownInstall = await fixture.api("POST", "/api/lsp/install", {
      language: "unknown_lang_123",
    });
    expect(unknownInstall.status).toBe(200);
    expect(unknownInstall.data.success).toBe(false);
    expect(typeof unknownInstall.data.error).toBe("string");

    const missingUninstall = await fixture.api("POST", "/api/lsp/uninstall", {});
    expect(missingUninstall.status).toBe(200);
    expect(missingUninstall.data.success).toBe(false);
    expect(typeof missingUninstall.data.error).toBe("string");

    const unknownUninstall = await fixture.api("POST", "/api/lsp/uninstall", {
      language: "unknown_lang_123",
    });
    expect(unknownUninstall.status).toBe(200);
    expect(unknownUninstall.data.success).toBe(false);
    expect(typeof unknownUninstall.data.error).toBe("string");
  });
});

describe("Session API", () => {
  test("GET /api/sessions should return array", async () => {
    const { status, data } = await fixture.api("GET", "/api/sessions");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("session list and detail include provider/model metadata for the chat agent", async () => {
    const suffix = Date.now();
    const providerId = `session-provider-${suffix}`;
    const agentId = `session-agent-${suffix}`;
    const sessionId = `session-metadata-${suffix}`;
    try {
      fixture.insertRawProvider(providerId, "openai", "OpenAI Test");
      fixture.insertRawAgent(agentId, "Session Metadata Agent", "{}", {
        model: "gpt-5-mini",
        providerId,
      });
      fixture.insertRawSession(sessionId, agentId, [{ role: "assistant", content: "hello" }]);

      const list = await fixture.api("GET", "/api/sessions");
      expect(list.status).toBe(200);
      const found = (
        list.data as Array<{
          id: string;
          provider?: string;
          provider_id?: string;
          provider_name?: string;
          model?: string;
        }>
      ).find((entry) => entry.id === sessionId);
      expect(found).toMatchObject({
        provider: "openai",
        provider_id: providerId,
        provider_name: "OpenAI Test",
        model: "gpt-5-mini",
      });

      const detail = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(detail.status).toBe(200);
      expect(detail.data).toMatchObject({
        provider: "openai",
        provider_id: providerId,
        provider_name: "OpenAI Test",
        model: "gpt-5-mini",
      });
    } finally {
      fixture.deleteRawSession(sessionId);
      fixture.deleteRawAgent(agentId);
      fixture.deleteRawProvider(providerId);
    }
  });

  test("session list and detail fall back to stored assistant model metadata", async () => {
    const suffix = Date.now();
    const sessionId = `session-stored-model-${suffix}`;
    const missingAgentId = `deleted-session-agent-${suffix}`;
    try {
      fixture.insertRawSession(sessionId, missingAgentId, [
        {
          role: "assistant",
          content: "hello from a previous model",
          metadata: {
            provider: "openai",
            provider_id: `deleted-provider-${suffix}`,
            provider_name: "OpenAI Snapshot",
            model: "gpt-4.1",
            agent_name: "Deleted Agent",
          },
        },
      ]);

      const list = await fixture.api("GET", "/api/sessions");
      expect(list.status).toBe(200);
      const found = (
        list.data as Array<{
          id: string;
          provider?: string;
          provider_id?: string;
          provider_name?: string;
          model?: string;
          agent_name?: string;
        }>
      ).find((entry) => entry.id === sessionId);
      expect(found).toMatchObject({
        provider: "openai",
        provider_id: `deleted-provider-${suffix}`,
        provider_name: "OpenAI Snapshot",
        model: "gpt-4.1",
        agent_name: "Deleted Agent",
      });

      const detail = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(detail.status).toBe(200);
      expect(detail.data).toMatchObject({
        provider: "openai",
        provider_id: `deleted-provider-${suffix}`,
        provider_name: "OpenAI Snapshot",
        model: "gpt-4.1",
        agent_name: "Deleted Agent",
      });
    } finally {
      fixture.deleteRawSession(sessionId);
    }
  });

  test("session workspace can be set and loaded via session routes", async () => {
    const initialWorkspace = process.cwd();
    const agentId = `workspace-session-agent-${Date.now()}`;
    fixture.insertRawAgent(agentId, "Workspace Session Agent", "{}");
    const create = await fixture.api("POST", "/api/chat", {
      message: `workspace-session-${Date.now()}`,
      agentId,
      workspaceDir: initialWorkspace,
    });
    try {
      expect(create.status).toBe(200);
      const sessionId = create.data.sessionId as string;
      expect(typeof sessionId).toBe("string");

      const detailBefore = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(detailBefore.status).toBe(200);
      expect(detailBefore.data.workspace_dir).toBe(initialWorkspace);

      const nextWorkspace = process.env.HOME || initialWorkspace;
      const update = await fixture.api("PUT", `/api/sessions/${sessionId}/workspace`, {
        workspaceDir: nextWorkspace,
      });
      expect(update.status).toBe(200);
      expect(update.data.success).toBe(true);
      expect(update.data.sessionId).toBe(sessionId);
      expect(update.data.workspaceDir).toBe(nextWorkspace);

      const detailAfter = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(detailAfter.status).toBe(200);
      expect(detailAfter.data.workspace_dir).toBe(nextWorkspace);

      const sessions = await fixture.api("GET", "/api/sessions");
      expect(sessions.status).toBe(200);
      const found = (sessions.data as Array<{ id: string; workspace_dir?: string | null }>).find(
        (entry) => entry.id === sessionId
      );
      expect(found).toBeDefined();
      expect(found?.workspace_dir).toBe(nextWorkspace);
    } finally {
      if (typeof create.data?.sessionId === "string") {
        fixture.deleteRawSession(create.data.sessionId);
      }
      fixture.deleteRawAgent(agentId);
    }
  });

  test("GET /api/sessions/:sessionId keeps artifact tool calls visible when tool list exceeds preview limit", async () => {
    const sessionId = `session-artifact-trunc-${Date.now()}`;
    const agentId = `agent-artifact-trunc-${Date.now()}`;
    const toolCalls = Array.from({ length: 55 }, (_, index) => ({
      id: `call-${index}`,
      name: "exec",
      args: { command: `echo ${index}` },
      status: "completed",
      result: { output: `exec-${index}` },
    }));
    toolCalls[54] = {
      id: "call-artifact",
      name: "artifacts",
      args: { action: "create", name: "task" },
      status: "completed",
      result: {
        action: "create",
        sessionId,
        artifact: {
          sessionId,
          name: "task",
          fileName: "task.md.resolved",
          path: `/Users/test/.cybara/artifacts/${sessionId}/task.md.resolved`,
          kind: "task",
          title: "Task",
          size: 42,
          createdAt: "2026-02-21T00:00:00.000Z",
          updatedAt: "2026-02-21T00:00:00.000Z",
        },
      },
    };

    fixture.insertRawSession(sessionId, agentId, [
      {
        role: "user",
        content: "Create an artifact",
        metadata: { source: "chat_api" },
      },
      {
        role: "assistant",
        content: "Done. Artifact created.",
        metadata: {
          source: "chat_api",
          tool_calls: toolCalls,
        },
      },
    ]);

    const loaded = await fixture.api("GET", `/api/sessions/${sessionId}`);
    expect(loaded.status).toBe(200);
    expect(Array.isArray(loaded.data.messagesList)).toBe(true);

    const assistant = (loaded.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as { tool_calls?: Array<Record<string, unknown>>; _truncated?: string } | undefined;
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant?.tool_calls)).toBe(true);
    expect(assistant?.tool_calls?.length).toBeLessThanOrEqual(50);
    expect(typeof assistant?._truncated).toBe("string");
    const previewTimelineIndexes = (assistant?.tool_calls || []).map((toolCall) => {
      const value = (toolCall as { timeline_index?: unknown }).timeline_index;
      return typeof value === "number" ? value : null;
    });
    expect(previewTimelineIndexes.every((value) => typeof value === "number")).toBe(true);
    for (let i = 1; i < previewTimelineIndexes.length; i += 1) {
      expect((previewTimelineIndexes[i] || 0) >= (previewTimelineIndexes[i - 1] || 0)).toBe(true);
    }

    const artifactCall = assistant?.tool_calls?.find((toolCall) => toolCall.name === "artifacts");
    expect(artifactCall).toBeDefined();
    expect((artifactCall?.result as Record<string, unknown>)?.artifact).toBeDefined();
    expect(
      ((artifactCall?.result as Record<string, unknown>)?.artifact as Record<string, unknown>)
        ?.fileName
    ).toBe("task.md.resolved");

    const loadedFull = await fixture.api(
      "GET",
      `/api/sessions/${sessionId}?includeFullToolCalls=1`
    );
    expect(loadedFull.status).toBe(200);
    const assistantFull = (loadedFull.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as { tool_calls?: Array<Record<string, unknown>>; _truncated?: string } | undefined;
    expect(assistantFull).toBeDefined();
    expect(assistantFull?._truncated).toBeUndefined();
    expect(Array.isArray(assistantFull?.tool_calls)).toBe(true);
    expect(assistantFull?.tool_calls?.length).toBe(55);
    const fullToolCalls = assistantFull?.tool_calls || [];
    const fullFirstTimelineIndex = (fullToolCalls[0] as { timeline_index?: unknown })
      ?.timeline_index;
    const fullLastTimelineIndex = (
      fullToolCalls[fullToolCalls.length - 1] as { timeline_index?: unknown }
    )?.timeline_index;
    expect(fullFirstTimelineIndex).toBe(0);
    expect(fullLastTimelineIndex).toBe(54);
  });

  test("GET /api/sessions/:sessionId always preserves full assistant content while tool detail remains selectable", async () => {
    const sessionId = `session-full-history-${Date.now()}`;
    const agentId = `agent-full-history-${Date.now()}`;
    const longAssistantContent = `Audit output\n${"A".repeat(12050)}`;
    const longToolResult = `tool-result-${"R".repeat(1400)}`;
    const longToolError = `tool-error-${"E".repeat(420)}`;
    const processActivities = Array.from({ length: 320 }, (_, index) => ({
      id: `activity-${index}`,
      phase: index % 7 === 0 ? "start" : "result",
      text: `activity-${index}-${"x".repeat(620)}`,
      timestamp: 1_770_000_000_000 + index,
      toolName: index % 11 === 0 ? "__thought" : "read",
    }));

    fixture.insertRawSession(sessionId, agentId, [
      {
        role: "user",
        content: "Run full audit",
        metadata: { source: "chat_api" },
      },
      {
        role: "assistant",
        content: longAssistantContent,
        metadata: {
          source: "chat_api",
          tool_calls: [
            {
              id: "call-full-0",
              name: "read",
              args: { path: "src/index.ts" },
              status: "failed",
              result: longToolResult,
              error: longToolError,
            },
          ],
          process_activities: processActivities,
        },
      },
    ]);

    const compact = await fixture.api("GET", `/api/sessions/${sessionId}`);
    expect(compact.status).toBe(200);
    const compactAssistant = (compact.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as Record<string, unknown> | undefined;
    expect(compactAssistant).toBeDefined();
    expect(String(compactAssistant?.content || "")).toBe(longAssistantContent);
    expect(String(compactAssistant?.content || "")).not.toContain("[content truncated");
    expect(
      ((compactAssistant?.process_activities as Array<Record<string, unknown>> | undefined) || [])
        .length
    ).toBeLessThanOrEqual(240);
    const compactTool = (
      compactAssistant?.tool_calls as Array<Record<string, unknown>> | undefined
    )?.[0];
    expect(typeof compactTool?.result).toBe("string");
    expect(String(compactTool?.result || "")).toContain("[truncated]");
    expect(String(compactTool?.error || "")).toContain("...");

    const full = await fixture.api("GET", `/api/sessions/${sessionId}?includeFullToolCalls=1`);
    expect(full.status).toBe(200);
    const fullAssistant = (full.data.messagesList as Array<Record<string, unknown>>).find(
      (entry) => entry.role === "assistant"
    ) as Record<string, unknown> | undefined;
    expect(fullAssistant).toBeDefined();
    expect(String(fullAssistant?.content || "")).toBe(longAssistantContent);
    expect(String(fullAssistant?.content || "")).not.toContain("[content truncated");
    expect(
      ((fullAssistant?.process_activities as Array<Record<string, unknown>> | undefined) || [])
        .length
    ).toBe(processActivities.length);

    const fullTool = (fullAssistant?.tool_calls as Array<Record<string, unknown>> | undefined)?.[0];
    expect(fullTool?.result).toBe(longToolResult);
    expect(fullTool?.error).toBe(longToolError);
    expect((fullAssistant as { _truncated?: string })._truncated).toBeUndefined();
  });

  test("GET /api/sessions/:sessionId/plan returns the latest sanitized todo plan", async () => {
    const sessionId = `session-plan-route-${Date.now()}`;
    const agentId = `agent-plan-route-${Date.now()}`;
    try {
      fixture.insertRawSession(sessionId, agentId, [
        {
          role: "assistant",
          content: "First plan",
          metadata: {
            source: "chat_api",
            tool_calls: [
              {
                id: "todo-old",
                name: "todo",
                status: "completed",
                result: {
                  items: [
                    {
                      content: "old item",
                      status: "completed",
                      priority: "low",
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          role: "assistant",
          content: "Updated plan",
          metadata: {
            source: "chat_api",
            tool_calls: [
              {
                id: "todo-new",
                name: "todo",
                status: "completed",
                result: {
                  items: [
                    {
                      content: "review auth",
                      status: "completed",
                      priority: "high",
                    },
                    {
                      content: "add fuzz test",
                      status: "in_progress",
                      priority: "medium",
                    },
                    {
                      content: "run CI",
                      status: "pending",
                      priority: "medium",
                    },
                  ],
                  note: "ready",
                },
              },
            ],
          },
        },
      ]);

      const detail = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(detail.status).toBe(200);
      expect(detail.data.plan.summary).toEqual({
        total: 3,
        pending: 1,
        inProgress: 1,
        completed: 1,
      });

      const plan = await fixture.api("GET", `/api/sessions/${sessionId}/plan`);
      expect(plan.status).toBe(200);
      expect(plan.data.sessionId).toBe(sessionId);
      expect(plan.data.plan).toEqual(detail.data.plan);
      expect(plan.data.plan.items.map((item: { content: string }) => item.content)).toEqual([
        "review auth",
        "add fuzz test",
        "run CI",
      ]);

      const missing = await fixture.api("GET", `/api/sessions/${sessionId}-missing/plan`);
      expect(missing.status).toBe(200);
      expect(missing.data.error).toBe("Session not found");
    } finally {
      fixture.deleteRawSession(sessionId);
    }
  });

  test("POST /api/sessions/:sessionId/revert truncates later conversation history", async () => {
    const agentId = `revert-session-agent-${Date.now()}`;
    fixture.insertRawAgent(agentId, "Revert Session Agent", "{}");
    const first = await fixture.api("POST", "/api/chat", {
      agentId,
      message: `revert-first-${Date.now()}`,
    });
    try {
      expect(first.status).toBe(200);
      const sessionId = first.data.sessionId as string;
      expect(typeof sessionId).toBe("string");

      const second = await fixture.api("POST", "/api/chat", {
        sessionId,
        message: `revert-second-${Date.now()}`,
      });
      expect(second.status).toBe(200);

      const third = await fixture.api("POST", "/api/chat", {
        sessionId,
        message: `revert-third-${Date.now()}`,
      });
      expect(third.status).toBe(200);

      const before = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(before.status).toBe(200);
      expect(before.data.messagesList.length).toBeGreaterThanOrEqual(4);
      const userIndexes = (before.data.messagesList as Array<{ role?: string }>).reduce<number[]>(
        (indexes, message, index) => {
          if (message.role === "user") indexes.push(index);
          return indexes;
        },
        []
      );
      expect(userIndexes.length).toBeGreaterThanOrEqual(2);
      const revertIndex = userIndexes[1] ?? userIndexes[0] ?? 0;
      const expectedKeptCount = revertIndex + 1;
      const expectedRemovedCount = before.data.messagesList.length - expectedKeptCount;
      const revertMessage = before.data.messagesList[revertIndex];
      const shiftedIndex =
        revertIndex + 1 < before.data.messagesList.length ? revertIndex + 1 : revertIndex;

      const reverted = await fixture.api("POST", `/api/sessions/${sessionId}/revert`, {
        messageIndex: shiftedIndex,
        messageRole: "user",
        messageContent: revertMessage.content,
        messageTimestamp: revertMessage.timestamp,
      });
      expect(reverted.status).toBe(200);
      expect(reverted.data.success).toBe(true);
      expect(reverted.data.sessionId).toBe(sessionId);
      expect(reverted.data.keptCount).toBe(expectedKeptCount);
      expect(reverted.data.removedCount).toBe(expectedRemovedCount);
      expect(reverted.data.removedFromIndex).toBe(revertIndex + 1);
      expect(reverted.data.messagesList).toHaveLength(expectedKeptCount);
      if (expectedKeptCount > 0) {
        expect(reverted.data.messagesList[expectedKeptCount - 1]).toMatchObject({
          role: "user",
          content: revertMessage.content,
        });
      }

      const after = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(after.status).toBe(200);
      expect(after.data.messagesList).toHaveLength(expectedKeptCount);
      if (expectedKeptCount > 0) {
        expect(after.data.messagesList[expectedKeptCount - 1]).toMatchObject({
          role: "user",
          content: revertMessage.content,
        });
      }
    } finally {
      if (typeof first.data?.sessionId === "string") {
        fixture.deleteRawSession(first.data.sessionId);
      }
      fixture.deleteRawAgent(agentId);
    }
  });

  test("POST /api/sessions/:sessionId/revert preserves retained message content", async () => {
    const sessionId = `revert-full-content-${Date.now()}`;
    const agentId = `revert-full-content-agent-${Date.now()}`;
    const longUserContent = `Complete retained request\n${"evidence ".repeat(1800)}`;
    fixture.insertRawSession(sessionId, agentId, [
      { role: "user", content: longUserContent },
      { role: "assistant", content: "Review complete" },
      { role: "user", content: "Follow-up that should be removed" },
    ]);

    try {
      const reverted = await fixture.api("POST", `/api/sessions/${sessionId}/revert`, {
        messageIndex: 0,
      });
      expect(reverted.status).toBe(200);
      expect(reverted.data.success).toBe(true);
      expect(reverted.data.messagesList).toHaveLength(1);
      expect(reverted.data.messagesList[0]?.content).toBe(longUserContent);
      expect(reverted.data.messagesList[0]?.content).not.toContain("[content truncated");

      const reloaded = await fixture.api("GET", `/api/sessions/${sessionId}`);
      expect(reloaded.status).toBe(200);
      expect(reloaded.data.messagesList[0]?.content).toBe(longUserContent);
    } finally {
      fixture.deleteRawSession(sessionId);
    }
  });

  test("POST /api/chat/sessions/:id/stop is session-scoped and idempotent", async () => {
    const response = await fixture.api("POST", `/api/chat/sessions/no-active-${Date.now()}/stop`);
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.stopped).toBe(false);
    expect(response.data.error).toBe("No active chat turn for session");
  });

  test("session artifact routes and artifacts tool manage session-scoped .md.resolved files", async () => {
    const sessionId = `artifact-session-${Date.now()}`;

    const create = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "task",
        name: "task",
        title: "Task Checklist",
        items: ["Design API", "Implement backend", "Wire UI preview"],
      },
      context: {
        sessionId,
      },
    });
    expect(create.status).toBe(200);
    expect(create.data.action).toBe("create");
    expect(create.data.artifact.fileName).toBe("task.md.resolved");

    const readViaKind = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "read",
        kind: "task",
      },
      context: {
        sessionId,
      },
    });
    expect(readViaKind.status).toBe(200);
    expect(readViaKind.data.action).toBe("read");
    expect(readViaKind.data.artifact.fileName).toBe("task.md.resolved");
    expect(typeof readViaKind.data.content).toBe("string");

    const readWithFallback = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "read",
        name: "does-not-exist",
        kind: "task",
      },
      context: {
        sessionId,
      },
    });
    expect(readWithFallback.status).toBe(200);
    expect(readWithFallback.data.action).toBe("read");
    expect(readWithFallback.data.fallback).toBe(true);
    expect(readWithFallback.data.resolvedFrom).toBe("does-not-exist");
    expect(readWithFallback.data.artifact.fileName).toBe("task.md.resolved");
    expect(typeof readWithFallback.data.content).toBe("string");

    const list = await fixture.api("GET", `/api/sessions/${sessionId}/artifacts`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data.artifacts)).toBe(true);
    expect(list.data.artifacts.length).toBeGreaterThan(0);
    expect(list.data.artifacts[0].fileName).toBe("task.md.resolved");

    const readBeforeCheck = await fixture.api(
      "GET",
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent("task.md.resolved")}`
    );
    expect(readBeforeCheck.status).toBe(200);
    expect(typeof readBeforeCheck.data.content).toBe("string");
    expect(readBeforeCheck.data.content).toContain("- [ ] Design API");

    const check = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "check",
        name: "task",
        item: 1,
        checked: true,
      },
      context: {
        sessionId,
      },
    });
    expect(check.status).toBe(200);
    expect(check.data.action).toBe("check");
    expect(check.data.checked).toBe(true);

    const readAfterCheck = await fixture.api(
      "GET",
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent("task.md.resolved")}`
    );
    expect(readAfterCheck.status).toBe(200);
    expect(readAfterCheck.data.content).toContain("- [x] Design API");

    const deleted = await fixture.api(
      "DELETE",
      `/api/sessions/${sessionId}/artifacts/${encodeURIComponent("task.md.resolved")}`
    );
    expect(deleted.status).toBe(200);
    expect(deleted.data.success).toBe(true);

    const listAfterDelete = await fixture.api("GET", `/api/sessions/${sessionId}/artifacts`);
    expect(listAfterDelete.status).toBe(200);
    expect(Array.isArray(listAfterDelete.data.artifacts)).toBe(true);
    expect(listAfterDelete.data.artifacts).toHaveLength(0);
  });

  test("artifacts are isolated per session id", async () => {
    const sessionA = `artifact-session-a-${Date.now()}`;
    const sessionB = `artifact-session-b-${Date.now()}`;

    const createA = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "notes",
        name: "notes",
        content: "# A\n",
      },
      context: { sessionId: sessionA },
    });
    expect(createA.status).toBe(200);

    const createB = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "notes",
        name: "notes",
        content: "# B\n",
      },
      context: { sessionId: sessionB },
    });
    expect(createB.status).toBe(200);

    const listA = await fixture.api("GET", `/api/sessions/${sessionA}/artifacts`);
    const listB = await fixture.api("GET", `/api/sessions/${sessionB}/artifacts`);
    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    expect(listA.data.artifacts).toHaveLength(1);
    expect(listB.data.artifacts).toHaveLength(1);

    const readA = await fixture.api(
      "GET",
      `/api/sessions/${sessionA}/artifacts/${encodeURIComponent("notes.md.resolved")}`
    );
    const readB = await fixture.api(
      "GET",
      `/api/sessions/${sessionB}/artifacts/${encodeURIComponent("notes.md.resolved")}`
    );
    expect(readA.status).toBe(200);
    expect(readB.status).toBe(200);
    expect(readA.data.content).toContain("# A");
    expect(readB.data.content).toContain("# B");
  });

  test("artifacts read returns missing payload instead of throwing when no artifact exists", async () => {
    const sessionId = `artifact-missing-${Date.now()}`;
    const readMissing = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "read",
        name: "task",
      },
      context: {
        sessionId,
      },
    });

    expect(readMissing.status).toBe(200);
    expect(readMissing.data.action).toBe("read");
    expect(readMissing.data.missing).toBe(true);
    expect(readMissing.data.count).toBe(0);
    expect(Array.isArray(readMissing.data.artifacts)).toBe(true);
  });

  test("GET /api/status/sessions returns active-session snapshot shape", async () => {
    const all = await fixture.api("GET", "/api/status/sessions");
    expect(all.status).toBe(200);
    expect(Array.isArray(all.data.activeSessions)).toBe(true);
    expect(Array.isArray(all.data.activeSessionIds)).toBe(true);
    expect(typeof all.data.count).toBe("number");

    const sessionId = `missing-session-${Date.now()}`;
    const scoped = await fixture.api(
      "GET",
      `/api/status/sessions?sessionId=${encodeURIComponent(sessionId)}`
    );
    expect(scoped.status).toBe(200);
    expect(scoped.data.sessionId).toBe(sessionId);
    expect(typeof scoped.data.active).toBe("boolean");
    expect(Array.isArray(scoped.data.activeSessionIds)).toBe(true);
  });

  test("GET /api/artifacts lists artifacts across sessions", async () => {
    const sessionA = `artifact-global-a-${Date.now()}`;
    const sessionB = `artifact-global-b-${Date.now()}`;

    const createdA = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "notes",
        name: "global-a",
        content: "# Global A\n",
      },
      context: { sessionId: sessionA },
    });
    expect(createdA.status).toBe(200);

    const createdB = await fixture.api("POST", "/api/tools/execute", {
      name: "artifacts",
      args: {
        action: "create",
        kind: "notes",
        name: "global-b",
        content: "# Global B\n",
      },
      context: { sessionId: sessionB },
    });
    expect(createdB.status).toBe(200);

    const allArtifacts = await fixture.api("GET", "/api/artifacts");
    expect(allArtifacts.status).toBe(200);
    expect(Array.isArray(allArtifacts.data.artifacts)).toBe(true);
    const summaries = allArtifacts.data.artifacts as Array<{
      sessionId: string;
      fileName: string;
    }>;
    expect(
      summaries.some(
        (summary) => summary.sessionId === sessionA && summary.fileName === "global-a.md.resolved"
      )
    ).toBe(true);
    expect(
      summaries.some(
        (summary) => summary.sessionId === sessionB && summary.fileName === "global-b.md.resolved"
      )
    ).toBe(true);
  });
});

describe("Tasks API", () => {
  test("POST /api/tasks/:id/run should resolve alias route", async () => {
    const runRes = await fixture.api("POST", `/api/tasks/nonexistent-${Date.now()}/run`);
    expect(runRes.status).toBe(200);
    expect(runRes.data.success).toBe(false);
  });

  test("GET /api/tasks and /api/tasks/:id tolerate malformed task config JSON", async () => {
    const taskId = `bad-task-config-${Date.now()}`;
    fixture.insertRawTask(taskId, `bad-task-${Date.now()}`, "{bad-json", "pending");

    const listRes = await fixture.api("GET", "/api/tasks");
    expect(listRes.status).toBe(200);
    const listed = (listRes.data as Array<{ id: string; config: Record<string, unknown> }>).find(
      (entry) => entry.id === taskId
    );
    expect(listed).toBeDefined();
    expect(listed?.config).toEqual({});

    const getRes = await fixture.api("GET", `/api/tasks/${taskId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(taskId);
    expect(getRes.data.config).toEqual({});

    await fixture.api("DELETE", `/api/tasks/${taskId}`);
  });

  test("task lifecycle routes create/get/start/stop/trigger/runs/delete", async () => {
    const agentId = `task-lifecycle-agent-${Date.now()}`;
    fixture.insertRawAgent(agentId, "Task Lifecycle Agent", "{}");
    const createRes = await fixture.api("POST", "/api/tasks", {
      name: `routes-task-${Date.now()}`,
      description: "integration task lifecycle",
      action: "Say hello from tasks integration test",
      agent_id: agentId,
      schedule: "0 * * * *",
      enabled: false,
    });
    let taskId = "";
    try {
      expect(createRes.status).toBe(200);
      expect(typeof createRes.data.id).toBe("string");
      taskId = createRes.data.id as string;

      const getRes = await fixture.api("GET", `/api/tasks/${taskId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.data.id).toBe(taskId);

      const startRes = await fixture.api("POST", `/api/tasks/${taskId}/start`);
      expect(startRes.status).toBe(200);
      expect(startRes.data.success).toBe(true);

      const stopRes = await fixture.api("POST", `/api/tasks/${taskId}/stop`);
      expect(stopRes.status).toBe(200);
      expect(stopRes.data.success).toBe(true);

      const triggerRes = await fixture.api("POST", `/api/tasks/${taskId}/trigger`);
      expect(triggerRes.status).toBe(200);
      expect(triggerRes.data.success).toBe(true);

      const runsRes = await fixture.api("GET", `/api/tasks/${taskId}/runs`);
      expect(runsRes.status).toBe(200);
      expect(Array.isArray(runsRes.data)).toBe(true);
      expect(runsRes.data.length).toBeGreaterThan(0);

      const deleteRes = await fixture.api("DELETE", `/api/tasks/${taskId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.data.success).toBe(true);
      taskId = "";
    } finally {
      if (taskId) {
        await fixture.api("DELETE", `/api/tasks/${taskId}`);
      }
      fixture.deleteRawAgent(agentId);
    }
  });
});

describe("Subagents API", () => {
  test("list/get/spawn/kill routes should be wired and validate required fields", async () => {
    const listRes = await fixture.api("GET", "/api/subagents");
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.data)).toBe(true);

    const getMissingRes = await fixture.api("GET", `/api/subagents/missing-${Date.now()}`);
    expect(getMissingRes.status).toBe(200);
    expect(getMissingRes.data.error).toBe("Subagent not found");

    const spawnMissingTaskRes = await fixture.api("POST", "/api/subagents/spawn", {});
    expect(spawnMissingTaskRes.status).toBe(200);
    expect(spawnMissingTaskRes.data.success).toBe(false);
    expect(typeof spawnMissingTaskRes.data.error).toBe("string");

    const killMissingRes = await fixture.api("POST", `/api/subagents/missing-${Date.now()}/kill`);
    expect(killMissingRes.status).toBe(200);
    expect(killMissingRes.data.success).toBe(false);
  });

  test("spawn route forwards optional agent/model metadata and returns session/run identifiers", async () => {
    const requestedAgentId = `requested-agent-${Date.now()}`;
    const providerId = `requested-provider-${Date.now()}`;
    const requesterSessionId = `parent-chat-${Date.now()}`;
    fixture.insertRawProvider(providerId, "openai", "Requested Subagent Provider");
    fixture.insertRawAgent(requestedAgentId, "Requested Subagent", "{}", {
      model: "gpt-test-model",
      providerId,
    });

    try {
      const spawnRes = await fixture.api("POST", "/api/subagents/spawn", {
        task: "api spawn metadata wiring",
        agentId: requestedAgentId,
        model: "gpt-test-model",
        runTimeoutSeconds: 0,
        label: "metadata test",
        cleanup: "keep",
        workspaceDir: process.cwd(),
        maxActiveChildren: 3,
        requesterSessionId,
      });

      expect(spawnRes.status).toBe(200);
      expect(spawnRes.data.success).toBe(true);
      expect(spawnRes.data.status).toBe("accepted");
      expect(typeof spawnRes.data.subagentId).toBe("string");
      expect(typeof spawnRes.data.sessionKey).toBe("string");
      expect(
        (spawnRes.data.sessionKey as string).startsWith(`agent:${requestedAgentId}:subagent:`)
      ).toBe(true);

      const getRes = await fixture.api("GET", `/api/subagents/${spawnRes.data.subagentId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.data.id).toBe(spawnRes.data.subagentId);
      expect(getRes.data.model).toBe("gpt-test-model");
      expect(getRes.data.workspaceDir).toBe(process.cwd());
      expect(getRes.data.runTimeoutSeconds).toBe(0);
      expect(getRes.data.cleanup).toBe("keep");
      expect(getRes.data.requesterSessionId).toBe(requesterSessionId);
      expect(Array.isArray(getRes.data.activities)).toBe(true);
      expect(Array.isArray(getRes.data.toolCalls)).toBe(true);

      const scopedListRes = await fixture.api(
        "GET",
        `/api/subagents?sessionId=${encodeURIComponent(requesterSessionId)}`
      );
      expect(scopedListRes.status).toBe(200);
      expect(scopedListRes.data.map((run: { id: string }) => run.id)).toEqual([
        spawnRes.data.subagentId,
      ]);

      const otherChatListRes = await fixture.api(
        "GET",
        `/api/subagents?sessionId=${encodeURIComponent(`${requesterSessionId}-other`)}`
      );
      expect(otherChatListRes.status).toBe(200);
      expect(otherChatListRes.data).toEqual([]);

      let status = String(getRes.data.status);
      for (let attempt = 0; attempt < 50 && ["pending", "running"].includes(status); attempt += 1) {
        await sleep(20);
        const current = await fixture.api("GET", `/api/subagents/${spawnRes.data.subagentId}`);
        status = String(current.data.status);
      }
      expect(["pending", "running"]).not.toContain(status);

      const waitRes = await fixture.api("POST", "/api/subagents/wait", {
        runIds: [spawnRes.data.subagentId],
        timeoutSeconds: 0,
        requesterSessionId,
      });
      expect(waitRes.status).toBe(200);
      expect(waitRes.data.status).toBe("completed");
      expect(waitRes.data.pendingRunIds).toEqual([]);
      expect(waitRes.data.runs[0]).toMatchObject({
        runId: spawnRes.data.subagentId,
        status: "completed",
      });
      expect(String(waitRes.data.runs[0].result)).toContain("No API key available");

      const crossSessionWaitRes = await fixture.api("POST", "/api/subagents/wait", {
        runIds: [spawnRes.data.subagentId],
        timeoutSeconds: 0,
        requesterSessionId: `${requesterSessionId}-other`,
      });
      expect(crossSessionWaitRes.status).toBe(200);
      expect(crossSessionWaitRes.data.success).toBe(false);
      expect(String(crossSessionWaitRes.data.error)).toContain("another session");

      const clearRes = await fixture.api(
        "DELETE",
        `/api/subagents?sessionId=${encodeURIComponent(requesterSessionId)}`
      );
      expect(clearRes.status).toBe(200);
      expect(clearRes.data).toEqual({ success: true, cleared: 1 });

      const clearedListRes = await fixture.api(
        "GET",
        `/api/subagents?sessionId=${encodeURIComponent(requesterSessionId)}`
      );
      expect(clearedListRes.data).toEqual([]);
    } finally {
      fixture.deleteRawAgent(requestedAgentId);
      fixture.deleteRawProvider(providerId);
    }
  });
});
