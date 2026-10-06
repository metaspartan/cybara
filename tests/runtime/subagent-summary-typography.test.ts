import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SUMMARY = [
  "## Results",
  "",
  "Audited the module and found **three** defects.",
  "",
  "### Severity",
  "",
  "| Issue | File | Severity |",
  "| --- | --- | --- |",
  "| Dead branch | `src/a.ts` | critical |",
  "| Missing await | `src/b.ts` | moderate |",
  "| Loose equality | `src/c.ts` | low |",
  "",
  "1. First item.",
  "2. Second item.",
  "",
  "- bullet one",
  "- bullet two",
  "",
  "> A quoted note.",
].join("\n");

let browser: Browser | undefined;
let page: Page | undefined;
let temp = "";
let entry = "";
let bundleFile = "";

function fixture(): string {
  return `import { MessageContent } from "./MessageContent";
import { createRoot } from "react-dom/client";

const summary = ${JSON.stringify(SUMMARY)};

function App() {
  return (
    <div style={{ padding: 24 }}>
      <h4 className="mb-2 text-[11px] font-semibold uppercase text-gray-500">Final output</h4>
      <div
        className="chat-activity-text rounded-md bg-white/[0.025] p-3 text-gray-300"
        style={{ width: 430 }}
      >
        <MessageContent content={summary} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
`;
}

interface Metrics {
  error?: string;
  h2Size: string;
  h2Weight: string;
  h2Margin: string;
  pMargin: string;
  tableDisplay: string;
  tableOverflow: string;
  tableBorderCollapse: string;
  thBorderBottom: string;
  thTextAlign: string;
  tdPadding: string;
  olListStyle: string;
  olPaddingLeft: string;
  ulListStyle: string;
  blockquoteBorderLeft: string;
  panelOverflows: boolean;
}

async function measure(): Promise<Metrics> {
  if (!page) throw new Error("no page");
  return await page.evaluate(() => {
    const panel = document.querySelector(".chat-activity-text") as HTMLElement | null;
    if (!panel) return { error: "no panel" } as unknown as Metrics;
    const pick = (sel: string): HTMLElement | null =>
      panel.querySelector(sel) as HTMLElement | null;
    const style = (el: HTMLElement | null): CSSStyleDeclaration | null =>
      el ? getComputedStyle(el) : null;
    const h2 = style(pick("h2"));
    const p = style(pick("p"));
    const table = pick("table");
    const tableStyle = style(table);
    const th = style(pick("th"));
    const td = style(pick("td"));
    const ol = style(pick("ol"));
    const ul = style(pick("ul"));
    const quote = style(pick("blockquote"));
    return {
      h2Size: h2?.fontSize ?? "",
      h2Weight: h2?.fontWeight ?? "",
      h2Margin: h2?.margin ?? "",
      pMargin: p?.margin ?? "",
      tableDisplay: tableStyle?.display ?? "",
      tableOverflow: tableStyle?.overflowX ?? "",
      tableBorderCollapse: tableStyle?.borderCollapse ?? "",
      thBorderBottom: th?.borderBottomWidth ?? "",
      thTextAlign: th?.textAlign ?? "",
      tdPadding: td?.padding ?? "",
      olListStyle: ol?.listStyleType ?? "",
      olPaddingLeft: ol?.paddingLeft ?? "",
      ulListStyle: ul?.listStyleType ?? "",
      blockquoteBorderLeft: quote?.borderLeftWidth ?? "",
      panelOverflows: table ? table.scrollWidth > panel.clientWidth + 1 : false,
    };
  });
}

beforeAll(async () => {
  temp = mkdtempSync(join(tmpdir(), "cybara-md-typography-"));
  entry = join(REPO, "ui", "src", "pages", "chat", `.md-typography-${crypto.randomUUID()}.tsx`);
  writeFileSync(entry, fixture(), "utf8");
  const build = await Bun.build({
    entrypoints: [entry],
    outdir: join(temp, "js"),
    naming: "bundle-[hash].js",
    target: "browser",
    tsconfig: join(REPO, "ui/tsconfig.json"),
  });
  if (!build.success) throw new Error(build.logs.map((l) => l.message).join("\n"));
  const entryName = build.outputs.find((o) => o.path.endsWith(".js"))?.path;
  if (!entryName) throw new Error("no bundle output");
  bundleFile = `js/${entryName.split(/[\\/]/).pop()}`;
  console.log("BUNDLE:", bundleFile, "HTML:", join(temp, "index.html"));
  const css = await Bun.build({
    entrypoints: [join(REPO, "ui/src/index.css")],
    outdir: join(temp, "css"),
    naming: "app.css",
    target: "browser",
  });
  if (!css.success) throw new Error(css.logs.map((l) => l.message).join("\n"));
  mkdirSync(join(temp, "js"), { recursive: true });
  writeFileSync(
    join(temp, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="css/app.css"></head><body class="bg-[#050508] text-white"><div id="root"></div><script src="${bundleFile}"></script></body></html>`,
    "utf8"
  );
  browser = await chromium.launch({
    executablePath: process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath(),
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 900, height: 900 } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  rmSync(temp, { recursive: true, force: true });
  if (entry) rmSync(entry, { force: true });
});

describe("subagent summary markdown typography", () => {
  test("headings, paragraphs, lists, quotes and tables are visually structured", async () => {
    if (!page) throw new Error("no page");
    await page.goto(`file://${join(temp, "index.html")}`);
    await page.locator(".chat-markdown h2").first().waitFor({ timeout: 20_000 });
    const m = await measure();
    console.log("METRICS:", JSON.stringify(m, null, 2));

    expect(parseFloat(m.h2Size)).toBeGreaterThan(parseFloat(m.pMargin.split(" ")[0] ?? "0") * 0);
    expect(Number(m.h2Weight)).toBeGreaterThanOrEqual(600);
    expect(m.h2Margin).not.toBe("0px");
    expect(m.pMargin).not.toBe("0px");

    expect(m.tableDisplay).toBe("block");
    expect(m.tableOverflow).toBe("auto");
    expect(m.tableBorderCollapse).toBe("collapse");
    expect(Number.parseFloat(m.thBorderBottom)).toBeGreaterThan(0);
    expect(m.thTextAlign).toBe("left");
    expect(m.tdPadding).not.toBe("0px");

    expect(m.olListStyle).toBe("decimal");
    expect(m.ulListStyle).toBe("disc");
    expect(parseFloat(m.olPaddingLeft)).toBeGreaterThan(0);
    expect(Number.parseFloat(m.blockquoteBorderLeft)).toBeGreaterThan(0);

    if (process.env.CYBARA_MD_TYPOGRAPHY_SCREENSHOT) {
      await page.screenshot({
        path: process.env.CYBARA_MD_TYPOGRAPHY_SCREENSHOT,
        fullPage: true,
      });
    }
  }, 90_000);
});
