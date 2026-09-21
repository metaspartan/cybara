import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentManager } from "../../src/core/agent";
import { EVIDENCE_RECEIPT_MARKER, getEvidenceReducerStats } from "../../src/core/evidence-reducer";

const liveEnabled = process.env.CYBARA_LIVE_E2E === "1";
const FATAL_TOKEN = "EVID2E-7F3A";

function resolveLiveAgentId(): string | undefined {
  const override = process.env.CYBARA_E2E_AGENT_ID?.trim();
  if (override) return override;
  return agentManager.list().find((agent) => (agent.model || "").toLowerCase() === "glm-5.3-flash")
    ?.id;
}

function buildLogCommand(): string {
  return [
    "sh -c '",
    'for i in $(seq 1 400); do echo "compile pass $i: module $i linked ok"; done;',
    `echo "FATAL ${FATAL_TOKEN}: linker stage aborted with 42 unresolved symbols";`,
    'for i in $(seq 401 480); do echo "cleanup pass $i: temp file $i removed"; done;',
    "exit 3'",
  ].join("");
}

describe("evidence reducer live end to end (glm-5.3-flash)", () => {
  test.skipIf(!liveEnabled)(
    "agent run reduces a large failing build log into a verified receipt and still reports the fatal token",
    async () => {
      const agentId = resolveLiveAgentId();
      expect(agentId).toBeDefined();
      const workspace = mkdtempSync(join(tmpdir(), "evidence-reducer-e2e-"));
      try {
        const prompt = [
          "Use the exec tool exactly once to run this command:",
          buildLogCommand(),
          "After it finishes, answer with: (1) the exact fatal token from the output (the token right after the word FATAL), and (2) how many unresolved symbols the linker reported. Do not run any other tools or commands.",
        ].join("\n");

        const result = await agentManager.execute(
          agentId as string,
          [{ role: "user", content: prompt }],
          {
            useMemory: false,
            allowedToolNames: ["exec"],
            workspaceDir: workspace,
          }
        );

        expect(result.failure).toBeUndefined();
        expect(result.content.toUpperCase()).toContain(FATAL_TOKEN);
        expect(result.content).toContain("42");

        const stats = getEvidenceReducerStats();
        expect(stats.reduced).toBeGreaterThanOrEqual(1);

        const execCall = (result.tool_calls || []).find((call) => call.name === "exec");
        expect(execCall).toBeDefined();
        const execOutput = (execCall?.result as { output?: string } | undefined)?.output ?? "";
        expect(execOutput).toContain(EVIDENCE_RECEIPT_MARKER);
        expect(execOutput).toContain(FATAL_TOKEN);
        expect(execOutput).toContain("Full output archived at:");
        expect(execOutput.length).toBeLessThan(14_000);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
    300_000
  );
});
