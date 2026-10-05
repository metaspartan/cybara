import { join } from "node:path";
import sharp from "sharp";

interface Group {
  id: string;
  runs: number;
  passed: number;
  mean_task_ms: number;
  median_task_ms: number;
  warmed_trials: number;
  scored_usage: { requests: number; failed_requests: number; input: number | null; output: number | null; total: number | null; cached: number | null; uncached: number | null; controls_match: boolean };
}
interface Phase { phase: string; groups: Group[] }
interface Claim { metric: string; cybara: number; hermes: number; reduction_percent: number }
const root = join(import.meta.dir, "..", "..", "..");
const evidence = join(root, "docs/evals/2026-10-04/hermes-warm");
const output = import.meta.dir;
const phases = await Bun.file(join(evidence, "summary.json")).json() as Phase[];
const main = phases.find(phase => phase.phase === "confirmation");
const verification = await Bun.file(join(evidence, "confirmation-checks.json")).json() as Array<{ assertions: Array<{passed:boolean}>; timing: {same_agent:boolean;warmup_verified:boolean;failed:boolean}|null; scored_usage: {controls_match:boolean;failed_requests:number}; repair: {passed:boolean}|null }>;
if (verification.length !== 12 || verification.some(check => check.assertions.some(assertion => !assertion.passed) || !check.timing?.same_agent || !check.timing.warmup_verified || check.timing.failed || !check.scored_usage.controls_match || check.scored_usage.failed_requests || check.repair?.passed === false)) throw new Error("Confirmation output and warmed control checks failed");
if (!main) throw new Error("Matched-approval pilot unavailable");
const a = main.groups.find(group => group.id === "cybara");
const b = main.groups.find(group => group.id === "hermes");
if (!a || !b || a.runs !== 6 || b.runs !== 6 || !a.scored_usage.controls_match || !b.scored_usage.controls_match || a.warmed_trials !== 6 || b.warmed_trials !== 6) throw new Error("Pilot controls/correctness verification incomplete");
if (a.scored_usage.failed_requests || b.scored_usage.failed_requests) throw new Error("Pilot contains provider failures; a complete token-win graphic is not justified");
const fullAccuracy = a.passed === 6 && b.passed === 6;
const reduction = (left: number, right: number): number => (1 - left / right) * 100;
const claims: Claim[] = [{ metric: "mean_wall_time", cybara: a.mean_task_ms, hermes: b.mean_task_ms, reduction_percent: reduction(a.mean_task_ms, b.mean_task_ms) }, { metric: "provider_requests", cybara: a.scored_usage.requests, hermes: b.scored_usage.requests, reduction_percent: reduction(a.scored_usage.requests, b.scored_usage.requests) }];
if (a.scored_usage.total !== null && b.scored_usage.total !== null) claims.push({ metric: "total_tokens", cybara: a.scored_usage.total, hermes: b.scored_usage.total, reduction_percent: reduction(a.scored_usage.total, b.scored_usage.total) });
const tokens = claims.find(claim => claim.metric === "total_tokens");
const jointWin = fullAccuracy && a.mean_task_ms < b.mean_task_ms && a.scored_usage.requests < b.scored_usage.requests && !!tokens && tokens.reduction_percent > 0;
const speedTokenWin = fullAccuracy && a.mean_task_ms < b.mean_task_ms && !!tokens && tokens.reduction_percent > 0;
const headline = speedTokenWin ? "Measured faster." : "Measured honestly.";
const major = speedTokenWin && tokens ? `${tokens.reduction_percent.toFixed(1)}%` : `${a.passed} / ${a.runs}`;
const majorLabel = speedTokenWin ? "fewer total tokens than Hermes" : "Cybara correctly completed trials";
const esc = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const source = await sharp(join(root, "cybara.png")).ensureAlpha().resize(1400, 1400, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
const pixels = source.data;
for (let i = 0; i < pixels.length; i += 4) {
  const low = Math.min(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0);
  const high = Math.max(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0);
  if (low > 232 && high - low < 26) pixels[i + 3] = 0;
}
const cutout = await sharp(pixels, { raw: { width: source.info.width, height: source.info.height, channels: 4 } }).png().toBuffer();
const mascot = `data:image/png;base64,${cutout.toString("base64")}`;
const font = "Segoe UI, Arial, Helvetica, sans-serif";
const navy = "#111D2C", orange = "#FF6A18", cream = "#FBF5E9";
const tile = (x: number, value: string, label: string, sub: string, dark: boolean): string => `<g><rect x="${x}" y="665" width="446" height="170" rx="8" fill="${dark ? navy : "#FFFFFF"}" stroke="#DECDB5" stroke-width="2"/><rect x="${x}" y="665" width="446" height="6" fill="${orange}"/><text x="${x + 24}" y="735" fill="${dark ? cream : navy}" font-family="${font}" font-size="54" font-weight="700">${esc(value)}</text><text x="${x + 24}" y="778" fill="${dark ? cream : navy}" font-family="${font}" font-size="23" font-weight="600">${esc(label)}</text><text x="${x + 24}" y="809" fill="${dark ? "#BDC8D3" : "#6A7785"}" font-family="${font}" font-size="18">${esc(sub)}</text></g>`;
const timeValue = speedTokenWin ? `${reduction(a.mean_task_ms,b.mean_task_ms).toFixed(1)}%` : `${(a.mean_task_ms/1000).toFixed(2)}s`;
const requestValue = a.scored_usage.requests < b.scored_usage.requests ? `${reduction(a.scored_usage.requests,b.scored_usage.requests).toFixed(1)}%` : `${a.scored_usage.requests} vs ${b.scored_usage.requests}`;
const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="#E8D9BF" stroke-width="1"/></pattern><filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#111D2C" flood-opacity="0.13"/></filter></defs><rect width="1600" height="900" fill="${cream}"/><rect width="1600" height="900" fill="url(#grid)" opacity="0.4"/><rect width="1600" height="14" fill="${orange}"/><g font-family="${font}"><circle cx="108" cy="96" r="19" fill="${orange}"/><text x="143" y="110" fill="${navy}" font-size="40" font-weight="700" letter-spacing="2">CYBARA</text><text x="342" y="108" fill="#697586" font-size="19" font-weight="600" letter-spacing="1.6">FUSED MODE</text><text x="1512" y="100" text-anchor="end" fill="${navy}" font-size="23" font-weight="600">Space Bunny Free</text><text x="1512" y="134" text-anchor="end" fill="#7A6A55" font-size="21">Oct 4, 2026</text><text x="88" y="295" fill="${navy}" font-size="100" font-weight="700" letter-spacing="-3">${esc(headline)}</text><text x="88" y="395" fill="#C7500F" font-size="100" font-weight="700" letter-spacing="-3">Same task</text><text x="88" y="495" fill="#C7500F" font-size="100" font-weight="700" letter-spacing="-3">success.</text><image x="955" y="119" width="584" height="518" href="${mascot}" filter="url(#shadow)"/><rect x="805" y="430" width="706" height="207" rx="8" fill="${navy}"/><rect x="805" y="430" width="9" height="207" fill="${orange}"/><text x="846" y="463" fill="#9CAEBC" font-size="19" letter-spacing="2">TOTAL TOKENS · WARMED SESSIONS</text><text x="841" y="575" fill="${orange}" font-size="128" font-weight="700" letter-spacing="-4">${esc(major)}</text><text x="846" y="611" fill="${cream}" font-size="25" font-weight="600">${esc(majorLabel)}</text><rect x="88" y="529" width="8" height="57" fill="${orange}"/><text x="115" y="571" fill="${navy}" font-size="34" font-weight="700">Cybara vs Hermes v0.21.5</text><text x="88" y="617" fill="#7A6A55" font-size="18">Both sessions warmed · Startup and warmup excluded from task clock</text><text x="88" y="644" fill="#7A6A55" font-size="18">Hermes uses fewer output + uncached tokens · Full receipts include warmup costs</text></g>${tile(88,`${a.passed} / ${a.runs}`,fullAccuracy ? "correct completion, both" : "correct completion, Cybara",`Exact output assertions · Hermes ${b.passed}/${b.runs}`,false)}${tile(577,timeValue,speedTokenWin ? "lower mean completion time" : "mean completion time, Cybara",`${(a.mean_task_ms/1000).toFixed(2)}s Cybara · ${(b.mean_task_ms/1000).toFixed(2)}s Hermes`,true)}${tile(1066,requestValue,a.scored_usage.requests < b.scored_usage.requests ? "fewer provider requests" : "requests · Hermes uses fewer",`${a.scored_usage.requests} Cybara · ${b.scored_usage.requests} Hermes`,false)}<line x1="88" y1="859" x2="1512" y2="859" stroke="#DECDB5"/><text x="88" y="887" fill="#7A6A55" font-family="${font}" font-size="20">6 workflow tasks · Windows · Same model, high reasoning, 8,192 cap · Scoped pilot, not universal superiority</text></svg>`;
await Bun.write(join(output,"cybara-vs-hermes.svg"),markup);
await sharp(Buffer.from(markup)).png({compressionLevel:9}).toFile(join(output,"cybara-vs-hermes.png"));
await Bun.write(join(evidence,"marketing-metrics.json"),JSON.stringify({verified:true,source_receipt:"confirmation.json",comparison:"Cybara fused / Hermes official v0.21.5",primary_metrics_win:jointWin,all_metrics_win:false,speed_and_token_win:speedTokenWin,claims,accuracy:{cybara:a.passed,hermes:b.passed,trials:6},scope:"Six distinct local workflow tasks, high reasoning,8192 cap; both sessions warmed on Windows",historical_phases:["preflight","baseline","candidate"],tradeoffs:{completion_tokens:{cybara:a.scored_usage.output,hermes:b.scored_usage.output},uncached_input:{cybara:a.scored_usage.uncached,hermes:b.scored_usage.uncached}},token_metric:"input + completion including cached input, not price",confirmation_available:phases.some(p=>p.phase==="confirmation")},null,2));
console.log(JSON.stringify({joint_win:jointWin,speed_and_token_win:speedTokenWin,claims,graphic:"1600x900",source:"confirmation.json"},null,2));
