import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../src/core/config";
import { handleExecuteCode } from "../../src/core/tools/handlers/execute-code";
import { buildSystemPrompt } from "../../src/core/system-prompt";

let root = "";
const previousApprovalMode = config.get("tool_approval_mode");
afterEach(() => {
  config.set("tool_approval_mode", previousApprovalMode ?? "ask");
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

test("one fused call reads actual inputs, computes and verifies exact output through enabled file tools", async () => {
  config.set("tool_approval_mode", "always_allow");
  root = mkdtempSync(join(tmpdir(), "cybara-fused-files-"));
  const input =
    '{"rows":[{"id":"a","value":5},{"id":"a","value":99},{"id":"b","value":-2}],"label":"  é🌻\\nTrue null false  "}';
  writeFileSync(join(root, "input.json"), input);
  const result = await handleExecuteCode(
    {
      language: "typescript",
      code: "const source=await cybara.read({path:'input.json'}); const data=JSON.parse(source.content);const seen=new Set<string>();const ids:string[]=[];let sum=0;for(const row of data.rows){if(seen.has(row.id))continue;seen.add(row.id);ids.push(row.id);sum+=row.value;}const answer={ids,sum,label:data.label};await cybara.write({path:'answer.json',content:JSON.stringify(answer)});const saved=JSON.parse((await cybara.read({path:'answer.json'})).content);const reference=data.rows.filter((row,index,rows)=>rows.findIndex(other=>other.id===row.id)===index);if(saved.sum!==reference.reduce((s,row)=>s+row.value,0)||JSON.stringify(saved.ids)!==JSON.stringify(reference.map(row=>row.id))||saved.label!==data.label)throw Error('Verification failed');return {verified:true,sum:saved.sum};",
    },
    {
      sessionId: `fusion-${crypto.randomUUID()}`,
      workspaceDir: root,
      confineToWorkspace: true,
      allowedToolNames: ["read", "write", "execute_code"],
    }
  );
  expect(result.ok).toBe(true);
  expect(result.result).toEqual({ verified: true, sum: 3 });
  expect(JSON.parse(readFileSync(join(root, "answer.json"), "utf8"))).toEqual({
    ids: ["a", "b"],
    sum: 3,
    label: "  é🌻\nTrue null false  ",
  });
  expect(readFileSync(join(root, "input.json"), "utf8")).toBe(input);
});

test("fusion namespace cannot access a disallowed tool and remains explicit trusted host execution", async () => {
  const result = await handleExecuteCode(
    { code: "return await cybara.write({path:'should-not-write',content:'blocked'});" },
    { allowedToolNames: ["read", "execute_code"] }
  );
  expect(result.ok).toBe(false);
  expect(result.error).toContain("write");
  const withFusion = buildSystemPrompt({ tools: ["read", "write", "exec", "execute_code"] });
  const withoutFusion = buildSystemPrompt({ tools: ["read", "write", "exec"] });
  expect(withFusion).toContain("independentlyComputedReference");
  expect(withFusion).toContain("Never hardcode answers");
  expect(withFusion).toContain("only requested fields");
  expect(withFusion).toContain("untrusted host code");
  expect(withFusion).toContain("real caller-visible evidence");
  expect(withoutFusion).not.toContain("prefer one execute_code");
});

test("JSON helpers verify object key order without accepting wrong array order or corrupting strings", async () => {
  config.set("tool_approval_mode", "always_allow");
  root = mkdtempSync(join(tmpdir(), "cybara-json-fusion-"));
  writeFileSync(join(root, "data.json"), '{"b":[1,2],"a":"  é🌻\\nTrue null false  "}');
  const result = await handleExecuteCode(
    {
      code: "const data=await cybara.readJson({path:'data.json'});cybara.assertEqual(data,{a:data.a,b:[1,2]});let rejected=false;try{cybara.assertEqual(data,{a:data.a,b:[2,1]})}catch{rejected=true}if(!rejected)throw Error('Array order was lost');const receipt=await cybara.writeJson({path:'out.json',value:{a:data.a,b:data.b}});return {verified:receipt.verified,rejected};",
    },
    {
      workspaceDir: root,
      confineToWorkspace: true,
      allowedToolNames: ["read", "write", "execute_code"],
    }
  );
  expect(result.ok).toBe(true);
  expect(result.result).toEqual({ verified: true, rejected: true });
  expect(JSON.parse(readFileSync(join(root, "out.json"), "utf8"))).toEqual(
    JSON.parse(readFileSync(join(root, "data.json"), "utf8"))
  );
});

test("JSON helpers are unavailable without their underlying file capabilities", async () => {
  const result = await handleExecuteCode(
    { code: "return await cybara.writeJson({path:'blocked.json',value:{x:1}});" },
    { allowedToolNames: ["read", "execute_code"] }
  );
  expect(result.ok).toBe(false);
  expect(result.error).toContain("writeJson");
});

test("JSON assertions reject unsupported values rather than equating them after lossy serialization", async () => {
  const result = await handleExecuteCode(
    {
      code: "let blocked=0;for(const value of [undefined,NaN,Infinity,{missing:undefined},[undefined]]){try{cybara.assertEqual(value,null)}catch{blocked++}}if(blocked!==5)throw Error('Unsupported values accepted');return blocked;",
    },
    { allowedToolNames: ["execute_code"] }
  );
  expect(result.ok).toBe(true);
  expect(result.result).toBe(5);
});
