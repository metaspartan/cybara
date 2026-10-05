import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

const FILES = [
  "src/index.ts",
  "src/ui/App.tsx",
  "src/core/thing.test.ts",
  "src/core/thing.spec.ts",
  "scripts/tool.mjs",
  "package.json",
  "bun.lock",
  "a/b/d.txt",
  "a/c/d.txt",
];

const LEGIT_PATTERNS = [
  "src/**/*.ts",
  "src/**/*.{ts,tsx}",
  "{package.json,bun.lock}",
  "src/**/*.{test,spec}.{ts,tsx}",
  "a/{b,c}/d.txt",
];

interface Probe {
  legit: { pattern: string; count: number }[];
  sink: { label: string; outcome: string }[];
  attack: { depth: number; length: number; outcome: string }[];
  boundary: { depth: number; outcome: string }[];
  globFiles: string[];
}

function runRealConsumerProbe(): Probe {
  const script = `
import micromatch from "micromatch";
import fg from "fast-glob";
import * as bracesModule from "braces";
const expand = bracesModule.braces ?? bracesModule.default;
const FILES = ${JSON.stringify(FILES)};
const LEGIT = ${JSON.stringify(LEGIT_PATTERNS)};
const deep = (d) => "{".repeat(d) + "a" + "}".repeat(d);
const attempt = (d) => {
  const p = deep(d);
  try { fg.sync([p], { onlyFiles: true }); return { depth: d, length: p.length, outcome: "accepted" }; }
  catch (e) { return { depth: d, length: p.length, outcome: e.name }; }
};
const sink = (label, fn) => { try { fn(); return { label, outcome: "accepted" }; } catch (e) { return { label, outcome: e.name }; } };
console.log(JSON.stringify({
  legit: LEGIT.map((p) => ({ pattern: p, count: micromatch(FILES, [p]).length })),
  sink: [
    sink("braces() default compile path", () => expand(deep(4000))),
    sink("fast-glob.sync (react-doctor / metro path)", () => fg.sync([deep(4000)], { onlyFiles: true })),
    sink("fast-glob.generateTasks (react-doctor / metro path)", () => fg.generateTasks([deep(4000)])),
  ],
  attack: [4000, 4900].map(attempt),
  boundary: [99, 100, 101].map((d) => ({ depth: d, outcome: attempt(d).outcome })),
  globFiles: fg.sync(["patches/*.patch"], { onlyFiles: true }),
}));
`;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: join(import.meta.dir, "..", ".."),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.signalCode ?? null).toBeNull();
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString()) as Probe;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const row = (label: string, value: string, good: boolean) =>
  `<tr><td>${escapeHtml(label)}</td><td class="${good ? "good" : "bad"}">${escapeHtml(value)}</td></tr>`;

function renderReport(probe: Probe): string {
  const legit = probe.legit
    .map((r) => row(r.pattern, `${r.count} match(es)`, r.count > 0))
    .join("");
  const sink = probe.sink.map((r) => row(r.label, r.outcome, r.outcome !== "accepted")).join("");
  const attack = probe.attack
    .map((r) =>
      row(
        `depth ${r.depth} (${r.length} chars, under the 10000 cap)`,
        r.outcome,
        r.outcome === "SyntaxError"
      )
    )
    .join("");
  const boundary = probe.boundary
    .map((r) =>
      row(
        `depth ${r.depth}`,
        r.outcome,
        r.depth <= 100 ? r.outcome === "accepted" : r.outcome === "SyntaxError"
      )
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:14px ui-monospace,SFMono-Regular,monospace;background:#0d1117;color:#e6edf3;padding:24px;margin:0}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;color:#8b949e;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.06em}
p.sub{color:#8b949e;margin:0 0 8px}
table{border-collapse:collapse;width:100%;max-width:940px}
td{border:1px solid #30363d;padding:6px 10px}
td:first-child{color:#c9d1d9;width:58%}
.good{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}
</style></head><body>
<h1>braces nesting-depth guard (GHSA-vfj7-8cjw-p6xm)</h1>
<p class="sub">Live output from the real micromatch + fast-glob consumer chain via patches/braces@3.0.3.patch</p>
<h2>Legitimate patterns still expand correctly</h2><table>${legit}</table>
<h2>Recursive AST sinks reject the attack instead of crashing</h2><table>${sink}</table>
<h2>Advisory attack input is rejected without crashing</h2><table>${attack}</table>
<h2>Boundary</h2><table>${boundary}</table>
<h2>fast-glob filesystem scan</h2><table>${row("patches/*.patch", `${probe.globFiles.length} file(s) found`, probe.globFiles.length > 0)}</table>
</body></html>`;
}

test("real glob consumer matches normally and rejects the nesting attack", () => {
  const probe = runRealConsumerProbe();
  expect(probe.legit.map((r) => r.count)).toEqual([3, 4, 2, 2, 2]);
  expect(probe.sink.map((r) => r.outcome)).toEqual(["SyntaxError", "SyntaxError", "SyntaxError"]);
  expect(probe.attack.map((r) => r.outcome)).toEqual(["SyntaxError", "SyntaxError"]);
  expect(probe.attack.every((r) => r.length < 10_000)).toBe(true);
  expect(probe.boundary.map((r) => r.outcome)).toEqual(["accepted", "accepted", "SyntaxError"]);
  expect(probe.globFiles.length).toBeGreaterThan(0);
});

test("live results render correctly in a real browser", async () => {
  const root = join(import.meta.dir, "../..");
  const probe = runRealConsumerProbe();
  const temp = mkdtempSync(join(tmpdir(), "cybara-glob-shot-"));
  const reportPath = join(temp, "report.html");
  await Bun.write(reportPath, renderReport(probe));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(Bun.file(reportPath), { headers: { "Content-Type": "text/html" } }),
  });

  try {
    browser = await chromium.launch({
      executablePath: process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath(),
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByRole("heading", { name: /braces nesting-depth guard/ }).waitFor();

    const expectedRows =
      probe.legit.length + probe.sink.length + probe.attack.length + probe.boundary.length + 1;
    expect(await page.locator("td.good").count()).toBe(expectedRows);
    expect(await page.locator("td.bad").count()).toBe(0);
    expect(errors).toEqual([]);

    const dir = process.env.CYBARA_GLOB_SCREENSHOT_DIR ?? join(root, ".scratch", "pr111");
    await page.screenshot({ path: join(dir, "glob-e2e-results.png"), fullPage: true });
  } finally {
    await browser?.close();
    server.stop(true);
    rmSync(temp, { recursive: true, force: true });
  }
}, 90_000);
