import { createHash } from "crypto";
import { readFileSync } from "fs";
import { agentManager, type AgentMessage } from "./src/core/agent";
import { providerManager } from "./src/core/providers";
import { verifyEvidenceReceipt } from "./src/core/evidence-reducer";

const archive = process.argv[2];
const exitCode = Number(process.argv[3]);
const source = readFileSync(archive, "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex").slice(0, 12);

const provider = providerManager.getWithCredentials("10b64063-8fdb-4c65-936f-b136157574f9");
if (!provider) {
  console.log("PROVIDER MISSING");
  process.exit(1);
}
const prompt = [
  "You reduce command output for a coding agent. Extract only the key evidence from the output below.",
  "Return STRICT JSON only, no prose, no code fences, matching exactly this schema:",
  '{"source_sha256":"<echo the hash>","exit_code":<echo the exit code>,"summary":"<what happened>","errors":["<notable errors/warnings>"],"quotes":["<exact lines copied verbatim from the output>"]}',
  "Rules:",
  `- source_sha256 must be exactly: ${sourceHash}`,
  `- exit_code must be exactly: ${exitCode}`,
  "- Copy every quote character-for-character from the output; never paraphrase, trim, or merge lines.",
  "- Quote the most diagnostic lines (failure messages, assertion results, test summaries). At least one quote when the command failed.",
  "- Keep the summary under 120 words. Omit errors array entries when there are none.",
  "",
  "Command output:",
  source,
].join("\n");
const messages: AgentMessage[] = [{ role: "user", content: prompt }];
const response = await agentManager.callLLM(provider, "glm-5.3-flash", messages, []);
const text = response.content;
console.log("=== raw aux response (first 700) ===");
console.log(text.slice(0, 700));
const verdict = verifyEvidenceReceipt(text, source, exitCode);
console.log("=== verdict (exit", exitCode, ", source", source.length, "chars) ===");
console.log(verdict.ok ? `OK rendered=${verdict.rendered.length}` : `REJECTED: ${verdict.reason}`);
