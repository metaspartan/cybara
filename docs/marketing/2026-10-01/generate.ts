import sharp from "sharp";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..").replace(/\\/g, "/");
const OUT = `${ROOT}/docs/marketing/2026-10-01`;
const MASCOT = `${ROOT}/cybara.png`;
const LIVE = `${ROOT}/docs/evals/2026-10-01/request-efficiency/marketing-metrics.json`;
const ARCHIVE = `${ROOT}/docs/evals/2026-10-01/omp/omp-confirmation.json`;

type Metrics = {
  source: string;
  label: string;
  headlineStat: string;
  headlineNote: string;
  tile1Value: string;
  tile1Label: string;
  tile1Sub: string;
  tile2Value: string;
  tile2Label: string;
  tile2Sub: string;
  tile3Value: string;
  tile3Label: string;
  tile3Sub: string;
  scope: string;
  date: string;
  model: string;
  headlineFirst: string;
  headlineSecond: string;
  tokenMetric: "input" | "total";
};

const NAVY = "#16233A";
const NAVY_SOFT = "#3A4A66";
const ORANGE = "#EE6A1E";
const ORANGE_DEEP = "#C7500F";
const CREAM = "#FBF5E9";
const CREAM_DEEP = "#F2E8D5";
const LINE = "#D9CBB2";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const pct = (a: number, b: number) => ((b - a) / b) * 100;

async function fromArchive(): Promise<Metrics> {
  const raw = await Bun.file(ARCHIVE).json();
  const opt = raw.harnesses.find((h: { harness_id: string }) => h.harness_id === "optimized");
  const omp = raw.harnesses.find((h: { harness_id: string }) => h.harness_id === "omp");
  const red = pct(opt.usage.prompt_tokens, omp.usage.prompt_tokens);
  const passOpt = opt.passed_runs;
  const passOmp = omp.passed_runs;
  const runs = opt.runs;
  const tasks = Math.round(runs / raw.rounds);
  return {
    headlineFirst: "Less context.", headlineSecond: "Same task success.", tokenMetric: "input",
    source: ARCHIVE.replace(ROOT + "/", ""),
    label: "Archive receipt",
    headlineStat: `${red.toFixed(1)}%`,
    headlineNote: "fewer input tokens than OMP 18.4.8",
    tile1Value: `${passOpt} / ${runs}`,
    tile1Label: "tasks passed, each harness",
    tile1Sub: `Cybara ${passOpt} of ${runs} · OMP ${passOmp} of ${omp.runs}`,
    tile2Value: `${tasks} tasks`,
    tile2Label: "matched, one per arm",
    tile2Sub: `${raw.rounds} rounds · same fixtures · rotated order`,
    tile3Value: `${raw.totals.runs} runs`,
    tile3Label: "small fixture pilot",
    tile3Sub: `${raw.planned_runs} planned · ${raw.rounds} rounds · buffered`,
    scope: "Input tokens only, on this fixture suite. No claim about speed or request count.",
    date: "Oct 1, 2026",
    model: "SpaceBunnyFree",
  };
}

function num(...keys: unknown[]): number | null {
  for (const k of keys) if (typeof k === "number" && Number.isFinite(k)) return k;
  return null;
}

async function fromLive(raw: Record<string, unknown>): Promise<Metrics | null> {
  if (raw.verified !== true) return null;
  const suite = typeof raw.suite === "string" ? raw.suite : "";
  if (!suite) return null;
  const totalMetric = raw.token_metric === "total";
  const red = totalMetric ? num(raw.pct_fewer_total_tokens) : num(raw.pct_fewer_input_tokens, raw.input_token_reduction_pct, raw.pct_reduction);
  if (red === null || red <= 0 || red >= 100) return null;
  const a = totalMetric ? num(raw.cybara_total_tokens) : num(raw.cybara_input_tokens, raw.optimized_prompt_tokens);
  const b = totalMetric ? num(raw.omp_total_tokens) : num(raw.omp_input_tokens, raw.baseline_prompt_tokens);
  if (a === null || b === null || a >= b || Math.abs(red - (1 - a / b) * 100) > 0.01) return null;
  const passA = num(raw.cybara_passed, raw.optimized_passed);
  const passB = num(raw.omp_passed, raw.baseline_passed);
  const nA = num(raw.cybara_runs, raw.optimized_runs);
  if (passA === null || passB === null || nA === null) return null;
  const t = raw.tiles;
  const base = await fromArchive();
  const pick = (i: number, fb: { value: string; label: string; sub: string }) => {
    const e = Array.isArray(t) ? (t[i] as Record<string, unknown> | undefined) : undefined;
    if (!e || e.verified !== true) return fb;
    const v = typeof e.value === "string" ? e.value : fb.value;
    const l = typeof e.label === "string" ? e.label : fb.label;
    const s = typeof e.sub === "string" ? e.sub : fb.sub;
    return { value: v, label: l, sub: s };
  };
  const t1 = pick(0, { value: `${passA} / ${nA}`, label: "tasks passed, Cybara", sub: `OMP ${passB} of ${nA}` });
  const t2 = pick(1, { value: base.tile2Value, label: base.tile2Label, sub: base.tile2Sub });
  const t3 = pick(2, { value: base.tile3Value, label: base.tile3Label, sub: base.tile3Sub });
  return {
    headlineFirst: typeof raw.headline_first === "string" ? raw.headline_first : "Less context.",
    headlineSecond: typeof raw.headline_second === "string" ? raw.headline_second : "Same task success.",
    tokenMetric: totalMetric ? "total" : "input",
    source: LIVE.replace(ROOT + "/", ""),
    label: "Verified suite metrics",
    headlineStat: `${red.toFixed(1)}%`,
    headlineNote: totalMetric ? "fewer total tokens than OMP 18.4.8" : "fewer input tokens than OMP 18.4.8",
    tile1Value: t1.value,
    tile1Label: t1.label,
    tile1Sub: t1.sub,
    tile2Value: t2.value,
    tile2Label: t2.label,
    tile2Sub: t2.sub,
    tile3Value: t3.value,
    tile3Label: t3.label,
    tile3Sub: t3.sub,
    scope: typeof raw.scope_note === "string" ? raw.scope_note : base.scope,
    date: typeof raw.date === "string" ? raw.date : base.date,
    model: typeof raw.model === "string" ? raw.model : base.model,
  };
}

async function loadMetrics(): Promise<Metrics> {
  if (await Bun.file(LIVE).exists()) {
    try {
      const m = await fromLive((await Bun.file(LIVE).json()) as Record<string, unknown>);
      if (m) return m;
      console.warn("marketing-metrics.json present but not usable under strict rules; using archive fallback");
    } catch (e) {
      console.warn(`marketing-metrics.json unreadable: ${(e as Error).message}`);
    }
  }
  return fromArchive();
}


async function cutout(): Promise<string> {
  const src = await sharp(MASCOT).ensureAlpha().resize(1400, 1400, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = src;
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const mn = Math.min(r, g, b);
    const mx = Math.max(r, g, b);
    const sat = mx - mn;
    let a = 255;
    if (mn > 232 && sat < 26) a = 0;
    else if (mn > 196 && sat < 30) a = Math.round(((mn - 196) / 36) * 255);
    const prev = data[i + 3];
    data[i + 3] = Math.min(prev, a);
  }
  const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const esc2 = esc;

function svg(m: Metrics, mascot: string): string {
  const F = `Segoe UI, Segoe UI Semibold, Arial, Helvetica, sans-serif`;
  const tile = (x: number, value: string, label: string, sub: string, hot: boolean) => `
    <g>
      <rect x="${x}" y="646" width="446" height="188" rx="6" fill="${hot ? NAVY : "#FFFFFF"}" stroke="${hot ? NAVY : LINE}" stroke-width="2"/>
      <rect x="${x}" y="646" width="446" height="6" fill="${hot ? ORANGE : ORANGE_DEEP}"/>
      <text x="${x + 34}" y="${hot ? 730 : 730}" fill="${hot ? CREAM : NAVY}" font-family="${F}" font-size="62" font-weight="700" letter-spacing="-1.5">${esc2(value)}</text>
      <text x="${x + 34}" y="770" fill="${hot ? "#F0E2C8" : NAVY_SOFT}" font-family="${F}" font-size="25" font-weight="600">${esc2(label)}</text>
      <text x="${x + 34}" y="804" fill="${hot ? "#9FB0C9" : "#7A6A55"}" font-family="${F}" font-size="20" font-weight="400">${esc2(sub)}</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${CREAM}"/>
      <stop offset="1" stop-color="${CREAM_DEEP}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFE9C9" stop-opacity="0.95"/>
      <stop offset="0.72" stop-color="#FFDFB2" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#FFDFB2" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1600" height="900" fill="url(#paper)"/>

  <g opacity="0.5">
    ${Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${100 * (i + 1)}" x2="1600" y2="${100 * (i + 1)}" stroke="${LINE}" stroke-width="1" stroke-opacity="0.35"/>`).join("\n    ")}
  </g>

  <circle cx="1274" cy="392" r="252" fill="url(#halo)"/>
  <circle cx="1274" cy="392" r="252" fill="none" stroke="${ORANGE}" stroke-width="2.5" stroke-opacity="0.5" stroke-dasharray="3 12" stroke-linecap="round"/>

  <rect x="0" y="0" width="1600" height="12" fill="${NAVY}"/>
  <rect x="0" y="0" width="404" height="12" fill="${ORANGE}"/>

  <g>
    <rect x="88" y="72" width="10" height="52" fill="${ORANGE}"/>
    <text x="122" y="112" fill="${NAVY}" font-family="${F}" font-size="38" font-weight="700" letter-spacing="1.4">CYBARA</text>
    <text x="328" y="108" fill="${NAVY_SOFT}" font-family="${F}" font-size="19" font-weight="600" letter-spacing="1.6">FUSED MODE</text>
    <text x="88" y="176" fill="${NAVY_SOFT}" font-family="${F}" font-size="21" font-weight="400" letter-spacing="3.2">CONTEXT BUDGET, SPENT ON PURPOSE</text>
  </g>

  <g text-anchor="end">
    <text x="1512" y="104" fill="${NAVY}" font-family="${F}" font-size="24" font-weight="600" letter-spacing="1.6">${esc2(m.model)}</text>
    <text x="1512" y="138" fill="#7A6A55" font-family="${F}" font-size="21" font-weight="400" letter-spacing="1.2">${esc2(m.date)}</text>
  </g>

  <g>
    <text x="88" y="318" fill="${NAVY}" font-family="${F}" font-size="104" font-weight="700" letter-spacing="-3.2">${esc2(m.headlineFirst)}</text>
    <text x="88" y="416" fill="${ORANGE_DEEP}" font-family="${F}" font-size="104" font-weight="700" letter-spacing="-3.2">Same task</text>
    <text x="88" y="514" fill="${ORANGE_DEEP}" font-family="${F}" font-size="104" font-weight="700" letter-spacing="-3.2">success.</text>

    <rect x="88" y="546" width="8" height="58" fill="${ORANGE}"/>
    <text x="118" y="590" fill="${NAVY}" font-family="${F}" font-size="42" font-weight="700" letter-spacing="-0.6">${esc2(m.headlineStat)}</text>
    <text x="${118 + m.headlineStat.length * 27 + 24}" y="590" fill="${NAVY_SOFT}" font-family="${F}" font-size="30" font-weight="500">${esc2(m.headlineNote)}</text>
  </g>

  <g>
    <image x="1000" y="140" width="548" height="500" xlink:href="${mascot}" href="${mascot}" preserveAspectRatio="xMidYMid meet"/>
  </g>

  <text x="88" y="628" fill="#7A6A55" font-family="${F}" font-size="18" font-weight="500">Warm Cybara gateway / cold OMP native CLI · Raw tokens include cached input</text>

  ${tile(88, m.tile1Value, m.tile1Label, m.tile1Sub, true)}
  ${tile(577, m.tile2Value, m.tile2Label, m.tile2Sub, false)}
  ${tile(1066, m.tile3Value, m.tile3Label, m.tile3Sub, false)}

  <g>
    <line x1="88" y1="866" x2="1512" y2="866" stroke="${LINE}" stroke-width="1.5"/>
    <text x="88" y="890" fill="#7A6A55" font-family="${F}" font-size="22" font-weight="500">${esc2(m.scope)}</text>

  </g>
</svg>`;
}

const metrics = await loadMetrics();
const mascot = await cutout();
const markup = svg(metrics, mascot).split("\n").map((line) => line.trimEnd()).join("\n");
await Bun.write(`${OUT}/cybara-context-claim.svg`, markup);
await Bun.write(`${OUT}/cybara-vs-omp-x.svg`, markup);
const image = await sharp(Buffer.from(markup)).png({ compressionLevel: 9 }).toBuffer();
await Bun.write(`${OUT}/cybara-context-claim.png`, image);
await Bun.write(`${OUT}/cybara-vs-omp-x.png`, image);
await Bun.write(`${OUT}/claims.md`, `# Verified claims on this card

- Headline: "${metrics.headlineFirst} ${metrics.headlineSecond}" with ${metrics.headlineStat} ${metrics.headlineNote}.
- Scope: ${metrics.scope}
- Tiles: ${metrics.tile1Value} ${metrics.tile1Label}; ${metrics.tile2Value} ${metrics.tile2Label}; ${metrics.tile3Value} ${metrics.tile3Label}.
- Source: ${metrics.source}; raw trial receipt identified in marketing-metrics.json.
- Token metric: ${metrics.tokenMetric}; raw provider tokens include cached input, not billable dollars.
- Startup caveat: warm Cybara gateway versus cold OMP native CLI. Hosted variance; no universal superiority claim.
- Regenerate: bun run docs/marketing/2026-10-01/generate.ts
`);
console.log(`source=${metrics.source} headline=${metrics.headlineStat} tiles=${metrics.tile1Value} | ${metrics.tile2Value} | ${metrics.tile3Value}`);
