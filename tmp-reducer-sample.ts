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
if (!provider) { console.log("PROVIDER MISSING"); process.exit(1); }
const prompt = [
  "You reduce command output for a coding agent. Extract only the key evidence from the output below.",
  "Return STRICT JSON only, no prose, no code fences, matching exactly this schema:",
  '{"source_sha256":"<echo the hash>","exit_code":<echo the exit code>,"summary":"<what happened>","errors":["<notable errors/warnings>"],"quotes":["<exact lines copied verbatim from the output>"]}',
  "Rules:",
  `- source_sha256 must be exactly: ${sourceHash}`,
  `- exit_code must be exactly: ${exitCode}`,
  "- Copy every quote character-for-character from the output; never paraphrase, trim, or merge lines.",
  "- Each quote must be one complete line copied verbatim from the output (including prefixes like (pass)/(fail) or error codes). Never quote bare numbers, fragments, or your own wording.",
  "- Quote the most diagnostic lines (failure messages, assertion results, test summaries). At least one quote when the command failed.",
  "- Keep the summary under 120 words. Omit errors array entries when there are none.",
  "",
  "Command output:",
  source,
].join("\n");
for (let i = 0; i < 3; i += 1) {
  const messages: AgentMessage[] = [{ role: "user", content: prompt }];
  const response = await agentManager.callLLM(provider, "glm-5.3-flash", messages, []);
  const verdict = verifyEvidenceReceipt(response.content, source, exitCode);
  let quotes: string[] = [];
  try {
    const m = response.content.match(/```(?:json)?\s*([\s\S]*?)```/) ;
    quotes = (JSON.parse(m ? m[1] : response.content).quotes ?? []).map((q: string) => q.slice(0, 60));
  } catch { quotes = ["<unparseable>"]; }
  console.log(`sample ${i + 1}: ${verdict.ok ? "OK" : `REJECTED: ${verdict.reason}`} | quotes=${JSON.stringify(quotes)}`);
}
