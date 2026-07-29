import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentManager } from "../../src/core/agent";
import { runSecurityScanTool } from "../../src/core/tools/handlers/security-scan";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("security scan tool", () => {
  test("uses active Cybara agent metadata for info and dry runs", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-security-workspace-"));
    cleanupPaths.push(workspace);
    const context = {
      agentId: "minimax-agent",
      workspaceDir: workspace,
      activeProviderId: "minimax-provider",
      activeProviderName: "MiniMax",
      activeModel: "MiniMax-M3",
    };

    const info = await runSecurityScanTool({ action: "info" }, context);
    const scan = await runSecurityScanTool(
      { action: "scan", dryRun: true, paths: ["src"] },
      context
    );

    expect(info.engine).toBe("active_agent");
    expect(info.output).toEqual(
      expect.objectContaining({
        agent_id: "minimax-agent",
        provider_id: "minimax-provider",
        provider_name: "MiniMax",
        model: "MiniMax-M3",
      })
    );
    expect(scan.engine).toBe("active_agent");
    expect(scan.output).toEqual(
      expect.objectContaining({
        dry_run: true,
        agent_id: "minimax-agent",
        model: "MiniMax-M3",
        paths: ["src"],
      })
    );
  });

  test("confines explicit targets to the active workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-security-workspace-"));
    cleanupPaths.push(workspace);
    await expect(
      runSecurityScanTool(
        { action: "scan", target: "..", dryRun: true },
        { agentId: "agent-1", workspaceDir: workspace, confineToWorkspace: true }
      )
    ).rejects.toThrow("outside the configured workspace root");
  });

  test("requires an active agent and findings for validation", async () => {
    await expect(runSecurityScanTool({ action: "info" })).rejects.toThrow(
      "active Cybara agent is unavailable"
    );
    await expect(
      runSecurityScanTool({ action: "validate", findings: [] }, { agentId: "agent-1" })
    ).rejects.toThrow("At least one finding is required");
  });

  test("keeps nested activity on the parent session and bounds validation work", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-security-workspace-"));
    cleanupPaths.push(workspace);
    const execute = spyOn(agentManager, "execute").mockResolvedValue({
      content: "No candidate finding survived validation.",
      provider: "z.ai-coding",
      provider_id: "provider-1",
      provider_name: "Zai",
      model: "glm-5.2",
      tool_calls: [],
    });

    try {
      const result = await runSecurityScanTool(
        { action: "validate", findings: ["Candidate finding"] },
        {
          agentId: "agent-1",
          sessionId: "session-1",
          workspaceDir: workspace,
          activeModel: "glm-5.2",
          modelParamsOverride: { temperature: 0.2 },
        }
      );

      expect(result.status).toBe("completed");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({
          sessionId: "session-1",
          modelOverride: "glm-5.2",
          modelParamsOverride: {
            temperature: 0.2,
            maxToolIterations: 12,
          },
        })
      );
    } finally {
      execute.mockRestore();
    }
  });

  test("returns a useful report when the active provider fails", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-security-workspace-"));
    cleanupPaths.push(workspace);
    const execute = spyOn(agentManager, "execute").mockResolvedValue({
      content: "",
      provider: "nvidia",
      provider_id: "provider-1",
      provider_name: "NVIDIA",
      model: "z-ai/glm-5.2",
      tool_calls: [{ id: "call-1", name: "read", arguments: {}, result: "ok" }],
      failure: { category: "rate_limit", retryable: true },
    });

    try {
      const result = await runSecurityScanTool(
        { action: "scan" },
        { agentId: "agent-1", workspaceDir: workspace }
      );
      const output = result.output as { report?: string };

      expect(result.status).toBe("failed");
      expect(output.report).toContain("nvidia/z-ai/glm-5.2 stopped with rate_limit");
      expect(output.report).toContain("after 1 read-only tool call");
      expect(output.report).toContain("No incomplete finding should be presented as validated");
    } finally {
      execute.mockRestore();
    }
  });
});
