import { basename, join } from "path";

interface PkgRef {
  name: string;
  version: string;
}

interface Workspace {
  label: string;
  lockfile: string;
  cwd: string;
  ignored: ReadonlySet<string>;
}

interface OsvVuln {
  id?: unknown;
  withdrawn?: unknown;
  database_specific?: { severity?: unknown } | undefined;
}

interface OsvQueryResult {
  vulns?: unknown;
}

interface OsvBatchResponse {
  results?: OsvQueryResult[];
}

interface BunAuditResult {
  exitCode: number | null;
  signalCode: string | null;
  stderr: string;
}

export type AuditOutcome =
  | { status: "ok"; source: "bun-audit" }
  | { status: "ok"; source: "osv-fallback"; findings: string[] }
  | { status: "failed"; source: "bun-audit"; detail: string }
  | { status: "failed"; source: "osv-fallback"; detail: string };

const OSV_QUERYBATCH_URL = "https://api.osv.dev/v1/querybatch";
const REPO_ROOT = join(import.meta.dirname, "..");
const OSV_BATCH_SIZE = 500;
const OSV_ATTEMPTS = 2;
const OSV_TIMEOUT_MS = 30_000;
const OSV_RETRY_DELAY_MS = 3_000;
const BUN_AUDIT_TIMEOUT_MS = 100_000;

const WORKSPACES: readonly Workspace[] = [
  {
    label: "root",
    lockfile: "bun.lock",
    cwd: REPO_ROOT,
    ignored: new Set(["GHSA-mh99-v99m-4gvg", "GHSA-jmr9-qjv8-65gv"]),
  },
  { label: "ui", lockfile: "ui/bun.lock", cwd: join(REPO_ROOT, "ui"), ignored: new Set() },
  {
    label: "mobile",
    lockfile: "apps/mobile/bun.lock",
    cwd: join(REPO_ROOT, "apps", "mobile"),
    ignored: new Set(["GHSA-w3rx-r6r6-pgpr", "GHSA-5p2g-fcmc-qvqq"]),
  },
  { label: "site", lockfile: "site/bun.lock", cwd: join(REPO_ROOT, "site"), ignored: new Set() },
];

const LOCKED_VERSION_PREFIXES = [
  "workspace:",
  "patch:",
  "npm:",
  "link:",
  "file:",
  "github:",
  "git+",
];

function extractPackagesSection(source: string): string {
  const marker = `"packages"`;
  const start = source.indexOf(marker);
  if (start === -1) return "";
  const open = source.indexOf("{", start + marker.length);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

function isLockedVersion(version: string): boolean {
  return (
    /^\d/.test(version) &&
    !LOCKED_VERSION_PREFIXES.some((p) => version.startsWith(p)) &&
    !version.includes("(") &&
    !version.includes("#")
  );
}

export function parseLockfilePackages(source: string): PkgRef[] {
  const section = extractPackagesSection(source);
  const refs = new Map<string, PkgRef>();
  for (const line of section.split("\n")) {
    const match = line.match(/"((?:@[^"@/\s]+\/)?[^"@/\s]+)@([^"]+)"/);
    if (!match) continue;
    const name = match[1];
    const version = match[2];
    if (!isLockedVersion(version)) continue;
    refs.set(`${name}@${version}`, { name, version });
  }
  return [...refs.values()];
}

export function isAdvisoryOutage(stderr: string): boolean {
  return (
    stderr.includes("security/advisories/bulk") ||
    /- 50\d\b/.test(stderr) ||
    /\b(Timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|unable to connect)\b/i.test(
      stderr
    )
  );
}

export function isTransportKill(result: BunAuditResult): boolean {
  return result.exitCode === null && result.signalCode !== null;
}

function vulnId(vuln: OsvVuln): string {
  return typeof vuln.id === "string" ? vuln.id : "unknown";
}

export function shouldFailOnVuln(vuln: OsvVuln, ignored: ReadonlySet<string>): boolean {
  if (vuln.withdrawn !== undefined) return false;
  const id = vulnId(vuln);
  if (ignored.has(id)) return false;
  const severity = vuln.database_specific?.severity;
  if (typeof severity === "string" && severity.toUpperCase() === "LOW") return false;
  return true;
}

export function chunkPackages(refs: readonly PkgRef[], size: number): PkgRef[][] {
  const chunks: PkgRef[][] = [];
  for (let i = 0; i < refs.length; i += size) {
    chunks.push(refs.slice(i, i + size));
  }
  return chunks;
}

function parseOsvBatch(value: unknown): OsvBatchResponse {
  if (typeof value !== "object" || value === null) return {};
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return {};
  return { results: results as OsvQueryResult[] };
}

function collectBatchFindings(
  chunk: readonly PkgRef[],
  batch: OsvBatchResponse,
  ignored: ReadonlySet<string>
): string[] {
  const findings: string[] = [];
  const results = batch.results ?? [];
  for (let i = 0; i < results.length; i += 1) {
    const vulns = results[i]?.vulns;
    if (!Array.isArray(vulns)) continue;
    const pkg = chunk[i];
    for (const raw of vulns) {
      if (typeof raw !== "object" || raw === null) continue;
      const vuln = raw as OsvVuln;
      if (!shouldFailOnVuln(vuln, ignored)) continue;
      findings.push(`${vulnId(vuln)} affects ${pkg.name}@${pkg.version}`);
    }
  }
  return findings;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = new Error("unreachable");
  for (let attempt = 1; attempt <= OSV_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < OSV_ATTEMPTS) {
      await Bun.sleep(OSV_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

async function queryOsvBatch(chunk: readonly PkgRef[]): Promise<OsvBatchResponse> {
  const body = JSON.stringify({
    queries: chunk.map((ref) => ({
      package: { name: ref.name, ecosystem: "npm" },
      version: ref.version,
    })),
  });
  const res = await fetchWithRetry(OSV_QUERYBATCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OSV querybatch failed: HTTP ${res.status}`);
  }
  return parseOsvBatch(await res.json());
}

export async function auditViaOsv(ws: Workspace): Promise<string[]> {
  const source = await Bun.file(join(ws.cwd, basename(ws.lockfile))).text();
  const refs = parseLockfilePackages(source);
  const findings: string[] = [];
  for (const chunk of chunkPackages(refs, OSV_BATCH_SIZE)) {
    const batch = await queryOsvBatch(chunk);
    findings.push(...collectBatchFindings(chunk, batch, ws.ignored));
  }
  return findings;
}

function runBunAuditAttempt(ws: Workspace): BunAuditResult {
  const args = ["audit", "--audit-level=moderate"];
  for (const id of ws.ignored) args.push("--ignore", id);
  const proc = Bun.spawnSync(["bun", ...args], {
    cwd: ws.cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: BUN_AUDIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return {
    exitCode: proc.exitCode,
    signalCode: proc.signalCode ?? null,
    stderr: proc.stderr.toString(),
  };
}

export async function auditWorkspace(ws: Workspace): Promise<AuditOutcome> {
  const result = runBunAuditAttempt(ws);
  if (result.exitCode === 0) return { status: "ok", source: "bun-audit" };
  if (!isTransportKill(result) && !isAdvisoryOutage(result.stderr)) {
    return { status: "failed", source: "bun-audit", detail: result.stderr.trim() };
  }
  try {
    const findings = await auditViaOsv(ws);
    return { status: findings.length === 0 ? "ok" : "failed", source: "osv-fallback", findings };
  } catch (err) {
    return {
      status: "failed",
      source: "osv-fallback",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<number> {
  const selected = Bun.argv.slice(2);
  const workspaces = selected.length
    ? WORKSPACES.filter((ws) => selected.includes(ws.label))
    : WORKSPACES;
  const failures: string[] = [];
  for (const ws of workspaces) {
    process.stdout.write(`[audit] ${ws.label}: auditing ${ws.lockfile}\n`);
    const outcome = await auditWorkspace(ws);
    if (outcome.status === "ok") {
      process.stdout.write(`[audit] ${ws.label}: passed via ${outcome.source}\n`);
      continue;
    }
    if (outcome.source === "bun-audit") {
      process.stderr.write(`[audit] ${ws.label}: failed\n${outcome.detail}\n`);
      failures.push(`${ws.label}: bun audit reported findings or errors`);
      continue;
    }
    if (outcome.findings.length > 0) {
      process.stderr.write(`[audit] ${ws.label}: OSV findings\n`);
      for (const finding of outcome.findings) process.stderr.write(`  - ${finding}\n`);
      failures.push(`${ws.label}: ${outcome.findings.length} OSV finding(s)`);
      continue;
    }
    process.stderr.write(`[audit] ${ws.label}: OSV fallback unavailable: ${outcome.detail}\n`);
    failures.push(`${ws.label}: advisory sources unreachable`);
  }
  if (failures.length > 0) {
    process.stderr.write(`[audit] FAILED: ${failures.join("; ")}\n`);
    return 1;
  }
  process.stdout.write(`[audit] all workspaces passed\n`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
