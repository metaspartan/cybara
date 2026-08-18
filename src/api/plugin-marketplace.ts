import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, join, resolve, sep } from "path";

import { resolveCybaraHome } from "../core/cybara-home";
import {
  CYBARA_PLUGIN_MANIFEST,
  installLocalPluginFromPath,
  listInstalledPlugins,
} from "../core/plugins";
import { readSubprocessStreamAsText } from "../core/subprocess-output";

const MARKETPLACE_ID = "official-community";
const MARKETPLACE_MANIFEST_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";
const MARKETPLACE_REPOSITORY_URL = "https://github.com/anthropics/claude-plugins-official.git";
const MARKETPLACE_CACHE_TTL_MS = 15 * 60 * 1000;
const MARKETPLACE_MAX_BYTES = 2 * 1024 * 1024;
const PLUGIN_CLONE_TIMEOUT_MS = 2 * 60 * 1000;

type MarketplaceAuthor = {
  name?: string;
};

type MarketplaceGitSource = {
  source: "github" | "url" | "git-subdir";
  repo?: string;
  url?: string;
  path?: string;
  ref?: string;
  sha?: string;
};

type MarketplacePluginSource = string | MarketplaceGitSource;

export type MarketplacePluginEntry = {
  name: string;
  displayName?: string;
  description: string;
  version?: string;
  author?: MarketplaceAuthor;
  category?: string;
  homepage?: string;
  source: MarketplacePluginSource;
  strict?: boolean;
  skills?: string[];
  commands?: string[];
  agents?: string[];
  hooks?: unknown;
  mcpServers?: unknown;
  lspServers?: unknown;
  monitors?: unknown;
  keywords?: string[];
  tags?: string[];
};

export type MarketplacePluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  category: string;
  marketplaceId: string;
  marketplace: string;
  capabilities: string[];
  installed: boolean;
  enabled: boolean;
};

export type MarketplacePluginPage = {
  plugins: MarketplacePluginSummary[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
};

export type MarketplacePluginInstallResult = {
  success: boolean;
  pluginId?: string;
  error?: string;
};

export function paginateMarketplacePlugins(
  plugins: MarketplacePluginSummary[],
  requestedPage: number,
  requestedPageSize: number
): MarketplacePluginPage {
  const pageSize = Math.max(1, Math.min(100, Math.floor(requestedPageSize)));
  const total = plugins.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), pageCount);
  const start = (page - 1) * pageSize;
  return {
    plugins: plugins.slice(start, start + pageSize),
    total,
    page,
    page_size: pageSize,
    page_count: pageCount,
  };
}

type MarketplaceDocument = {
  plugins: MarketplacePluginEntry[];
};

type MarketplaceCache = {
  expiresAt: number;
  plugins: MarketplacePluginEntry[];
};

let memoryCache: MarketplaceCache | undefined;

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringList(value: unknown, maxItems = 16): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => boundedText(item, 256))
    .filter(Boolean)
    .slice(0, maxItems);
  return values.length > 0 ? values : undefined;
}

function parseAuthor(value: unknown): MarketplaceAuthor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const name = boundedText((value as Record<string, unknown>).name, 160);
  return name ? { name } : undefined;
}

function parseSource(value: unknown): MarketplacePluginSource | undefined {
  if (typeof value === "string") {
    const source = boundedText(value, 512);
    return source.startsWith("./") ? source : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const source = boundedText(record.source, 32);
  if (source !== "github" && source !== "url" && source !== "git-subdir") return undefined;
  const parsed: MarketplaceGitSource = { source };
  const repo = boundedText(record.repo, 512);
  const url = boundedText(record.url, 1024);
  const path = boundedText(record.path, 512);
  const ref = boundedText(record.ref, 256);
  const sha = boundedText(record.sha, 64);
  if (repo) parsed.repo = repo;
  if (url) parsed.url = url;
  if (path) parsed.path = path;
  if (ref) parsed.ref = ref;
  if (sha) parsed.sha = sha;
  if (source === "github" && !parsed.repo) return undefined;
  if ((source === "url" || source === "git-subdir") && !parsed.url) return undefined;
  if (source === "git-subdir" && !parsed.path) return undefined;
  return parsed;
}

export function parsePluginMarketplace(value: unknown): MarketplacePluginEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rawPlugins = (value as Record<string, unknown>).plugins;
  if (!Array.isArray(rawPlugins)) return [];
  const plugins: MarketplacePluginEntry[] = [];
  for (const raw of rawPlugins.slice(0, 1000)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const name = boundedText(record.name, 160);
    const description = boundedText(record.description, 4000);
    const source = parseSource(record.source);
    if (!name || !description || !source) continue;
    plugins.push({
      name,
      displayName: boundedText(record.displayName, 160) || undefined,
      description,
      version: boundedText(record.version, 64) || undefined,
      author: parseAuthor(record.author),
      category: boundedText(record.category, 80) || undefined,
      homepage: boundedText(record.homepage, 1024) || undefined,
      source,
      strict: record.strict !== false,
      skills: stringList(record.skills),
      commands: stringList(record.commands),
      agents: stringList(record.agents),
      hooks: record.hooks,
      mcpServers: record.mcpServers,
      lspServers: record.lspServers,
      monitors: record.monitors,
      keywords: stringList(record.keywords),
      tags: stringList(record.tags),
    });
  }
  return plugins;
}

export function marketplacePluginId(name: string): string {
  const normalized = normalizeIdentifier(name);
  if (!normalized) throw new Error("Marketplace plugin name is required");
  return `marketplace-${MARKETPLACE_ID}-${normalized}`;
}

function cachePath(): string {
  return join(resolveCybaraHome().dir, "cache", "plugin-marketplaces", `${MARKETPLACE_ID}.json`);
}

function readDiskCache(): MarketplacePluginEntry[] {
  try {
    const path = cachePath();
    if (!existsSync(path) || statSync(path).size > MARKETPLACE_MAX_BYTES) return [];
    return parsePluginMarketplace(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return [];
  }
}

async function fetchMarketplaceDocument(): Promise<MarketplaceDocument> {
  const response = await fetch(MARKETPLACE_MANIFEST_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Plugin marketplace returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MARKETPLACE_MAX_BYTES) throw new Error("Plugin marketplace is too large");
  const text = await response.text();
  if (Buffer.byteLength(text) > MARKETPLACE_MAX_BYTES)
    throw new Error("Plugin marketplace is too large");
  const parsed = JSON.parse(text) as unknown;
  const plugins = parsePluginMarketplace(parsed);
  if (plugins.length === 0) throw new Error("Plugin marketplace contains no valid plugins");
  const path = cachePath();
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
  return { plugins };
}

async function loadMarketplacePlugins(forceRefresh = false): Promise<MarketplacePluginEntry[]> {
  if (!forceRefresh && memoryCache && memoryCache.expiresAt > Date.now()) {
    return memoryCache.plugins;
  }
  try {
    const document = await fetchMarketplaceDocument();
    memoryCache = {
      expiresAt: Date.now() + MARKETPLACE_CACHE_TTL_MS,
      plugins: document.plugins,
    };
    return document.plugins;
  } catch (error) {
    const cached = readDiskCache();
    if (cached.length > 0) {
      memoryCache = { expiresAt: Date.now() + 60_000, plugins: cached };
      return cached;
    }
    throw error;
  }
}

function capabilitiesFor(entry: MarketplacePluginEntry): string[] {
  const capabilities: string[] = [];
  if (entry.skills?.length) capabilities.push("Skills");
  if (entry.commands?.length) capabilities.push("Commands");
  if (entry.agents?.length) capabilities.push("Agents");
  if (entry.hooks) capabilities.push("Hooks");
  if (entry.mcpServers) capabilities.push("MCP");
  if (entry.lspServers) capabilities.push("LSP");
  if (entry.monitors) capabilities.push("Monitors");
  return capabilities.length > 0 ? capabilities : ["Plugin bundle"];
}

function summarizePlugin(
  entry: MarketplacePluginEntry,
  installed: Map<string, { enabled: boolean }>
): MarketplacePluginSummary {
  const id = marketplacePluginId(entry.name);
  const state = installed.get(id);
  return {
    id,
    name: entry.displayName || entry.name,
    version: /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(entry.version ?? "")
      ? (entry.version as string)
      : "Latest",
    description: entry.description,
    author: entry.author?.name,
    homepage: entry.homepage,
    category: entry.category || "Extension",
    marketplaceId: MARKETPLACE_ID,
    marketplace: "Official community",
    capabilities: capabilitiesFor(entry),
    installed: !!state,
    enabled: state?.enabled ?? false,
  };
}

export async function discoverMarketplacePlugins(options: {
  query?: string;
  filter?: "all" | "installed" | "available";
  page?: number;
  pageSize?: number;
  forceRefresh?: boolean;
}): Promise<MarketplacePluginPage> {
  const query = options.query?.trim().toLowerCase() ?? "";
  const filter = options.filter ?? "all";
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize ?? 24)));
  const installed = new Map(
    listInstalledPlugins().map(
      (plugin) => [plugin.manifest.id, { enabled: plugin.enabled }] as const
    )
  );
  const plugins = await loadMarketplacePlugins(options.forceRefresh);
  const matching = plugins
    .filter((entry) => {
      if (!query) return true;
      return [
        entry.name,
        entry.displayName,
        entry.description,
        entry.author?.name,
        entry.category,
        ...(entry.keywords ?? []),
        ...(entry.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .map((entry) => summarizePlugin(entry, installed))
    .filter((plugin) => {
      if (filter === "installed") return plugin.installed;
      if (filter === "available") return !plugin.installed;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return paginateMarketplacePlugins(matching, requestedPage, pageSize);
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

function safeSubdirectory(root: string, path: string): string {
  if (!path || path.startsWith("/") || path.startsWith("~")) {
    throw new Error("Plugin source path is invalid");
  }
  const candidate = resolve(root, path.replace(/^\.\//, ""));
  if (!isWithin(resolve(root), candidate)) throw new Error("Plugin source escapes its repository");
  if (!existsSync(candidate)) throw new Error("Plugin source directory was not found");
  const canonicalRoot = realpathSync(root);
  const canonicalCandidate = realpathSync(candidate);
  if (!isWithin(canonicalRoot, canonicalCandidate)) {
    throw new Error("Plugin source resolves outside its repository");
  }
  return canonicalCandidate;
}

function githubUrl(repo: string): string {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo)) {
    throw new Error("Plugin repository is invalid");
  }
  return `https://github.com/${repo}.git`;
}

function validateRepositoryUrl(value: string): string {
  const normalized = value.trim().replace(/^git@github\.com:/, "https://github.com/");
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) {
    throw new Error("Only public GitHub plugin repositories are supported");
  }
  return normalized.endsWith(".git") ? normalized : `${normalized}.git`;
}

function sourcePlan(entry: MarketplacePluginEntry): {
  repository: string;
  path?: string;
  revision?: string;
} {
  if (typeof entry.source === "string") {
    return {
      repository: MARKETPLACE_REPOSITORY_URL,
      path: entry.source,
      revision: "main",
    };
  }
  const repository =
    entry.source.source === "github"
      ? githubUrl(entry.source.repo ?? "")
      : validateRepositoryUrl(entry.source.url ?? "");
  return {
    repository,
    path: entry.source.source === "git-subdir" ? entry.source.path : undefined,
    revision: entry.source.sha || entry.source.ref,
  };
}

async function runGit(args: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "pipe",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      process.kill();
      reject(new Error("Plugin download timed out"));
    }, PLUGIN_CLONE_TIMEOUT_MS);
  });
  try {
    const exitCode = await Promise.race([process.exited, timeout]);
    if (exitCode !== 0) {
      const error = (await readSubprocessStreamAsText(process.stderr)).trim();
      throw new Error(error || "Plugin repository download failed");
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function clonePlugin(entry: MarketplacePluginEntry, destination: string): Promise<string> {
  const plan = sourcePlan(entry);
  mkdirSync(destination, { recursive: true });
  await runGit(["init", "--quiet"], destination);
  await runGit(["remote", "add", "origin", plan.repository], destination);
  if (plan.path) {
    const sparsePath = plan.path.replace(/^\.\//, "");
    await runGit(["sparse-checkout", "init", "--cone"], destination);
    await runGit(["sparse-checkout", "set", sparsePath], destination);
  }
  await runGit(
    ["fetch", "--quiet", "--filter=blob:none", "--depth", "1", "origin", plan.revision || "HEAD"],
    destination
  );
  await runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], destination);
  return plan.path ? safeSubdirectory(destination, plan.path) : destination;
}

function markdownFiles(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root)
    .filter((entry) => entry.toLowerCase().endsWith(".md"))
    .map((entry) => join(root, entry));
}

function adaptCommandPrompts(stagingRoot: string, pluginName: string): void {
  const commandsRoot = join(stagingRoot, "commands");
  for (const commandPath of markdownFiles(commandsRoot)) {
    const name = normalizeIdentifier(basename(commandPath, ".md"));
    if (!name) continue;
    const skillRoot = join(stagingRoot, "skills", name);
    const skillPath = join(skillRoot, "SKILL.md");
    if (existsSync(skillPath)) continue;
    mkdirSync(skillRoot, { recursive: true });
    const content = readFileSync(commandPath, "utf8");
    writeFileSync(
      skillPath,
      `---\nname: ${name}\ndescription: ${pluginName} command workflow.\n---\n\n${content}\n`,
      { mode: 0o600 }
    );
  }
}

function adaptRootSkill(stagingRoot: string, pluginName: string): void {
  const rootSkill = join(stagingRoot, "SKILL.md");
  if (!existsSync(rootSkill)) return;
  const name = normalizeIdentifier(pluginName);
  if (!name) return;
  const skillRoot = join(stagingRoot, "skills", name);
  mkdirSync(skillRoot, { recursive: true });
  cpSync(rootSkill, join(skillRoot, "SKILL.md"));
}

export function prepareMarketplacePluginRoot(
  sourceRoot: string,
  stagingRoot: string,
  entry: MarketplacePluginEntry
): string {
  cpSync(sourceRoot, stagingRoot, { recursive: true });
  rmSync(join(stagingRoot, ".git"), { recursive: true, force: true });
  adaptRootSkill(stagingRoot, entry.name);
  adaptCommandPrompts(stagingRoot, entry.displayName || entry.name);
  const id = marketplacePluginId(entry.name);
  const version = /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(entry.version ?? "")
    ? (entry.version as string)
    : "1.0.0";
  const manifest = {
    schemaVersion: 1,
    id,
    name: entry.displayName || entry.name,
    version,
    description: entry.description,
    author: entry.author?.name,
    homepage: entry.homepage,
    contributions: { skills: { dirs: existsSync(join(stagingRoot, "skills")) ? ["skills"] : [] } },
  };
  writeFileSync(
    join(stagingRoot, CYBARA_PLUGIN_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    {
      mode: 0o600,
    }
  );
  return id;
}

export async function installMarketplacePlugin(input: {
  id: string;
  marketplace?: string;
}): Promise<MarketplacePluginInstallResult> {
  if (input.marketplace && input.marketplace !== MARKETPLACE_ID) {
    return { success: false, error: "Unknown plugin marketplace" };
  }
  const entries = await loadMarketplacePlugins();
  const entry = entries.find((candidate) => marketplacePluginId(candidate.name) === input.id);
  if (!entry) return { success: false, error: "Marketplace plugin not found" };
  const tempRoot = mkdtempSync(join(tmpdir(), "cybara-plugin-marketplace-"));
  const repositoryRoot = join(tempRoot, "repository");
  const stagingRoot = join(tempRoot, "plugin");
  try {
    const sourceRoot = await clonePlugin(entry, repositoryRoot);
    const id = prepareMarketplacePluginRoot(sourceRoot, stagingRoot, entry);
    const installed = installLocalPluginFromPath(stagingRoot);
    return { success: true, pluginId: installed.manifest.id || id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Plugin install failed",
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
