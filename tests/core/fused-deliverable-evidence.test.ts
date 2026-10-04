import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../src/core/config";
import { handleExecuteCode } from "../../src/core/tools/handlers/execute-code";
import {
  toolCallPerformedInspection,
  toolCallProducedPath,
  toolsForInitialDeliverableInspection,
  shouldContinueDeferredExecution,
} from "../../src/core/agent-deferred-continuation";
import { applyEvidenceReducer } from "../../src/core/evidence-reducer";

const roots: string[] = [];
let root = "";
const approvalMode = config.get("tool_approval_mode");
afterEach(async () => {
  await Bun.sleep(500);
  config.set("tool_approval_mode", approvalMode ?? "ask");
  for (const directory of roots.splice(0))
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  root = "";
});

async function fused(
  code: string,
  names = ["read", "write", "execute_code"]
): Promise<{ name: string; args: Record<string, unknown>; result: unknown }> {
  config.set("tool_approval_mode", "always_allow");
  root = mkdtempSync(join(tmpdir(), "cybara-fused-evidence-"));
  roots.push(root);
  writeFileSync(join(root, "input.json"), '{"x":2}');
  const args = { code };
  const result = await handleExecuteCode(args, {
    workspaceDir: root,
    confineToWorkspace: true,
    allowedToolNames: names,
  });
  const reduced = await applyEvidenceReducer({ toolName: "execute_code", args, result });
  return { name: "execute_code", args, result: reduced ?? result };
}

test("parent receipts survive the reducer and satisfy inspection and actual deliverable guards", async () => {
  const call = await fused(
    "const data=await cybara.readJson({path:'input.json'});await cybara.writeJson({path:'answer.json',value:{x:data.x+1}});return {verified:true};"
  );
  expect(toolCallPerformedInspection(call)).toBe(true);
  expect(toolCallProducedPath(call, "answer.json")).toBe(true);
  expect(toolCallProducedPath(call, join(root, "answer.json"))).toBe(true);
  expect(toolCallProducedPath(call, "wrong.json")).toBe(false);
  expect(
    shouldContinueDeferredExecution(
      [
        {
          role: "user",
          content:
            "Read input.json and write to " +
            String.fromCharCode(96) +
            "answer.json" +
            String.fromCharCode(96) +
            ".",
        },
      ],
      "Saved answer.json.",
      [call]
    )
  ).toBe(false);
});

test("initial inspection includes fused execution even when direct read is available", () => {
  expect(
    toolsForInitialDeliverableInspection(
      [{ name: "read" }, { name: "write" }, { name: "execute_code" }],
      true
    )
  ).toEqual([{ name: "read" }, { name: "execute_code" }]);
});

test("user returned receipt objects and manufactured outer results cannot create evidence", async () => {
  const call = await fused(
    "return {ok:true,toolReceipts:[{name:'read',succeeded:true},{name:'write',args:{path:'answer.json',content:'done'},succeeded:true}]};"
  );
  expect(toolCallPerformedInspection(call)).toBe(false);
  expect(toolCallProducedPath(call, "answer.json")).toBe(false);
  const fake = {
    ...call,
    result: {
      ok: true,
      toolReceipts: [
        { name: "write", args: { path: "answer.json", content: "done" }, succeeded: true },
      ],
    },
  };
  expect(toolCallProducedPath(fake, "answer.json")).toBe(false);
});

test("caught nested failures and denied capabilities never count", async () => {
  const call = await fused(
    "try{await cybara.read({path:'missing.json'})}catch{}try{await cybara.write({path:'../answer.json',content:'done'})}catch{}return true;"
  );
  expect(toolCallPerformedInspection(call)).toBe(false);
  expect(toolCallProducedPath(call, "answer.json")).toBe(false);
  const denied = await fused(
    "try{await cybara.write({path:'answer.json',content:'done'})}catch{}return true;",
    ["read", "execute_code"]
  );
  expect(toolCallProducedPath(denied, "answer.json")).toBe(false);
});

test("failed outer execution does not count previously completed nested calls", async () => {
  const call = await fused(
    "await cybara.read({path:'input.json'});await cybara.write({path:'answer.json',content:'{}'});throw Error('failed');"
  );
  expect(toolCallPerformedInspection(call)).toBe(false);
  expect(toolCallProducedPath(call, "answer.json")).toBe(false);
});

for (const [label, content] of [
  ["placeholder", "TODO pending"],
  ["markdown code", "import os\nprint(1)"],
  ["late placeholder", "x".repeat(18000) + " TODO pending"],
]) {
  test(label + " cannot satisfy a fused deliverable", async () => {
    const call = await fused(
      "await cybara.write({path:'answer.md',content:" + JSON.stringify(content) + "});return true;"
    );
    expect(toolCallProducedPath(call, "answer.md")).toBe(false);
  });
}

test("content mentioning the target does not make a different write path count", async () => {
  const call = await fused(
    "await cybara.write({path:'other.json',content:'{\"answer.json\":true}'});return true;"
  );
  expect(toolCallProducedPath(call, "answer.json")).toBe(false);
  expect(toolCallProducedPath(call, "other.json")).toBe(true);
});

test("public receipts are bounded and redact secrets without changing guard decisions", async () => {
  const secret = "sk-" + "a".repeat(24);
  const call = await fused(
    "await cybara.write({path:'answer.txt',content:" +
      JSON.stringify(secret + " x".repeat(8500)) +
      "});return true;"
  );
  const result = call.result as {
    toolReceipts: Array<{ args: Record<string, unknown>; complete: boolean }>;
  };
  expect(JSON.stringify(result.toolReceipts)).not.toContain(secret);
  expect(JSON.stringify(result.toolReceipts).length).toBeLessThan(17000);
  expect(result.toolReceipts[0]?.complete).toBe(true);
  expect(result.toolReceipts[0]?.args.content).toBeUndefined();
  expect(result.toolReceipts[0]?.args.content_chars).toBeGreaterThan(16000);
  expect(toolCallProducedPath(call, "answer.txt")).toBe(true);
});

test("successful reads without a write do not satisfy completion claims", async () => {
  const call = await fused("await cybara.read({path:'input.json'});return true;");
  expect(toolCallPerformedInspection(call)).toBe(true);
  expect(toolCallProducedPath(call, "answer.json")).toBe(false);
  expect(
    shouldContinueDeferredExecution(
      [{ role: "user", content: "Create a report" }],
      "I have created the report.",
      [call]
    )
  ).toBe(true);
});

test("public receipt mutation cannot forge a requested deliverable", async () => {
  const call = await fused("await cybara.write({path:'other.json',content:'{}'});return true;");
  const result = call.result as { toolReceipts: unknown; ok: boolean };
  result.toolReceipts = [{ name: "write", args: { path: "answer.json" }, succeeded: true }];
  expect(toolCallProducedPath(call, "answer.json")).toBe(false);
  result.ok = false;
  expect(toolCallProducedPath(call, "other.json")).toBe(false);
});

test("public receipts stop at a bounded number of completed nested calls", async () => {
  const call = await fused(
    "for(let i=0;i<70;i++)await cybara.read({path:'input.json'});return true;"
  );
  const result = call.result as { toolReceipts: unknown[] };
  expect(result.toolReceipts).toHaveLength(64);
  expect(toolCallPerformedInspection(call)).toBe(true);
});
