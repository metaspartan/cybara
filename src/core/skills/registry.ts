/**
 * Skills Registry
 * Multi-registry compatible skill install/sync (ClawdHub, skills.sh, CybaraHub)
 */

import { mkdir, writeFile, readFile, rm, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve, sep } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { extractZipArchive } from "../archive";

/**
 * Registry provider interface
 * Implement this for each registry (ClawdHub, skills.sh, CybaraHub)
 */
export interface SkillRegistry {
  name: string;
  baseUrl: string;

  /** Search for skills by query */
  search(query: string, options?: RegistrySearchOptions): Promise<RegistrySkill[]>;

  /** Get skill details by slug/name */
  get(slug: string): Promise<RegistrySkillDetails | null>;

  /** Download skill content */
  download(slug: string): Promise<SkillDownload>;

  /** List popular/recent skills (for browse) */
  list?(options?: RegistryBrowseOptions): Promise<RegistrySkill[] | RegistryListResult>;

  /** Check for updates to installed skills */
  checkUpdates?(installed: InstalledSkillInfo[]): Promise<UpdateInfo[]>;
}

export type RegistrySort =
  | "updated"
  | "downloads"
  | "stars"
  | "rating"
  | "installsCurrent"
  | "installs"
  | "installsAllTime"
  | "trending";

export type RegistrySearchOptions = {
  limit?: number;
};

export type RegistryBrowseOptions = {
  limit?: number;
  sort?: RegistrySort;
  cursor?: string;
};

export type RegistryListResult = {
  items: RegistrySkill[];
  nextCursor?: string | null;
};

export type RegistrySkill = {
  slug: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  downloads?: number;
  installsCurrent?: number;
  installsAllTime?: number;
  stars?: number;
  tags?: string[];
  updatedAt?: number;
  moderation?: {
    isSuspicious: boolean;
    isMalwareBlocked: boolean;
  } | null;
};

export type RegistrySkillDetails = RegistrySkill & {
  version: string;
  readme?: string;
  homepage?: string;
  repository?: string;
  dependencies?: string[];
};

export type SkillDownload = {
  slug: string;
  version: string;
  files: Array<{
    path: string;
    content: string;
  }>;
};

export type InstalledSkillInfo = {
  name: string;
  version?: string;
  registry?: string;
};

export type UpdateInfo = {
  name: string;
  currentVersion: string;
  latestVersion: string;
  registry: string;
};

const REGISTRY_MAX_LIMIT = 200;
const REGISTRY_DEFAULT_LIMIT = 100;
const REGISTRY_DEFAULT_MAX_PAGES = 3;

function sanitizeLimit(value: number | undefined, fallback = REGISTRY_DEFAULT_LIMIT): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  return Math.max(1, Math.min(REGISTRY_MAX_LIMIT, normalized));
}

function sanitizeMaxPages(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  const normalized = Math.floor(value);
  return Math.max(1, Math.min(REGISTRY_DEFAULT_MAX_PAGES, normalized));
}

function mapClawHubTags(input: unknown): string[] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  return Object.keys(input as Record<string, unknown>);
}

/**
 * ClawdHub Registry Implementation
 * https://clawhub.ai - Official Cybara skill registry
 */
export class ClawdHubRegistry implements SkillRegistry {
  name = "clawhub";
  baseUrl = "https://clawhub.ai";

  // Simple in-memory cache with TTL
  private cache = new Map<string, { data: unknown; expires: number }>();
  private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && entry.expires > Date.now()) {
      return entry.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, expires: Date.now() + this.CACHE_TTL });
  }

  async search(query: string, options?: RegistrySearchOptions): Promise<RegistrySkill[]> {
    const limit = sanitizeLimit(options?.limit, REGISTRY_DEFAULT_LIMIT);
    const cacheKey = `search:${query}:${limit}`;
    const cached = this.getCached<RegistrySkill[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results?: Array<{
          slug?: string;
          displayName?: string;
          summary?: string | null;
          version?: string | null;
          score?: number;
          updatedAt?: number;
        }>;
      };
      const results = (data.results ?? [])
        .map((r) => ({
          slug: r.slug ?? "",
          name: r.displayName ?? r.slug ?? "",
          description: r.summary ?? "",
          version: r.version ?? undefined,
          updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : undefined,
        }))
        .filter((r) => r.slug);
      this.setCache(cacheKey, results);
      return results;
    } catch (err) {
      console.warn(`[ClawdHub] Search failed:`, err);
      return [];
    }
  }

  async get(slug: string): Promise<RegistrySkillDetails | null> {
    try {
      const url = `${this.baseUrl}/api/v1/skills/${encodeURIComponent(slug)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        skill?: {
          slug: string;
          displayName: string;
          summary?: string | null;
          tags?: unknown;
          stats?: unknown;
        };
        latestVersion?: {
          version: string;
          changelog?: string;
        } | null;
        owner?: {
          handle?: string | null;
          displayName?: string | null;
        } | null;
        moderation?: {
          isSuspicious?: boolean;
          isMalwareBlocked?: boolean;
        } | null;
      };
      if (!data.skill) return null;
      return {
        slug: data.skill.slug,
        name: data.skill.displayName,
        description: data.skill.summary ?? "",
        version: data.latestVersion?.version ?? "latest",
        author: data.owner?.displayName ?? data.owner?.handle ?? undefined,
        moderation: data.moderation
          ? {
              isSuspicious: data.moderation.isSuspicious === true,
              isMalwareBlocked: data.moderation.isMalwareBlocked === true,
            }
          : null,
      };
    } catch {
      return null;
    }
  }

  async download(slug: string): Promise<SkillDownload> {
    // ClawdHub returns a ZIP file with the skill content
    const url = `${this.baseUrl}/api/v1/download?slug=${encodeURIComponent(slug)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download skill: ${slug}`);

    // Check if it's a ZIP file
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/zip")) {
      // Write to temp and use unzip command
      const buffer = await res.arrayBuffer();

      // Fallback: use JSZip or handle manually
      // For now, write to temp and use unzip command
      const tempDir = join(homedir(), ".cybara", "temp", slug);
      const zipPath = join(tempDir, `${slug}.zip`);
      await mkdir(tempDir, { recursive: true });
      await writeFile(zipPath, Buffer.from(buffer));

      extractZipArchive(zipPath, tempDir);

      // Find and read skill file (case-insensitive, also check for skill.json)
      const files = await readdir(tempDir, { recursive: true });
      const allFiles: string[] = [];
      for (const f of files) {
        if (typeof f === "string") allFiles.push(f);
      }

      // Look for skill.md (case insensitive) or skill.json
      const skillMdPath = allFiles.find((f) => f.toLowerCase().endsWith("skill.md"));
      const skillJsonPath = allFiles.find((f) => f.toLowerCase().endsWith("skill.json"));

      // Get version from filename if available
      const disposition = res.headers.get("content-disposition");
      const versionMatch = disposition?.match(/(\d+\.\d+\.\d+)/);

      if (skillMdPath) {
        const content = await readFile(join(tempDir, skillMdPath), "utf-8");
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        return {
          slug,
          version: versionMatch?.[1] ?? "latest",
          files: [{ path: "SKILL.md", content }],
        };
      }

      // If no skill.md but has skill.json, read all .md files as skill content
      if (skillJsonPath) {
        const mdFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".md"));
        const fileContents: Array<{ path: string; content: string }> = [];

        for (const mdFile of mdFiles) {
          const content = await readFile(join(tempDir, mdFile), "utf-8");
          fileContents.push({ path: mdFile, content });
        }

        await rm(tempDir, { recursive: true, force: true }).catch(() => {});

        if (fileContents.length > 0) {
          return {
            slug,
            version: versionMatch?.[1] ?? "latest",
            files: fileContents,
          };
        }
      }

      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`No skill files found in ZIP for: ${slug}`);
    }

    // Fallback to JSON response (old behavior)
    return res.json() as Promise<SkillDownload>;
  }

  /** List recent skills (for browse) */
  async list(options?: RegistryBrowseOptions): Promise<RegistryListResult> {
    const limit = sanitizeLimit(options?.limit, REGISTRY_DEFAULT_LIMIT);
    const sort = options?.sort ?? "downloads";
    const cursor = options?.cursor?.trim() || "";
    const cacheKey = `list:${sort}:${limit}:${cursor}`;
    const cached = this.getCached<RegistryListResult>(cacheKey);
    if (cached) return cached;

    try {
      const searchParams = new URLSearchParams();
      searchParams.set("limit", String(limit));
      searchParams.set("sort", sort);
      if (cursor.length > 0) {
        searchParams.set("cursor", cursor);
      }
      const url = `${this.baseUrl}/api/v1/skills?${searchParams.toString()}`;
      const res = await fetch(url);
      if (!res.ok) return { items: [], nextCursor: null };
      const data = (await res.json()) as {
        items?: Array<{
          slug: string;
          displayName: string;
          summary?: string | null;
          stats?: {
            downloads?: number;
            stars?: number;
            installsCurrent?: number;
            installsAllTime?: number;
          };
          tags?: Record<string, string>;
          updatedAt?: number;
          latestVersion?: { version: string } | null;
        }>;
        nextCursor?: string | null;
      };
      const items = (data.items ?? []).map((s) => ({
        slug: s.slug,
        name: s.displayName,
        description: s.summary ?? "",
        downloads: s.stats?.downloads,
        installsCurrent: s.stats?.installsCurrent,
        installsAllTime: s.stats?.installsAllTime,
        stars: s.stats?.stars,
        tags: mapClawHubTags(s.tags),
        updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : undefined,
        version: s.latestVersion?.version,
      }));

      if (items.length === 0 && (!cursor || cursor === "")) {
        const searchFallback = await this.search("agent", { limit });
        return { items: searchFallback, nextCursor: null };
      }

      const result: RegistryListResult = {
        items,
        nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
      };
      this.setCache(cacheKey, result);
      return result;
    } catch (err) {
      console.warn(`[ClawHub] List failed:`, err);
      return { items: [], nextCursor: null };
    }
  }
}

/**
 * skills.sh Registry Implementation
 * https://skills.sh - Vercel's Agent Skills Directory
 */
export class SkillsShRegistry implements SkillRegistry {
  name = "skills.sh";
  baseUrl = "https://skills.sh";

  // Simple in-memory cache with TTL
  private cache = new Map<string, { data: unknown; expires: number }>();
  private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && entry.expires > Date.now()) {
      return entry.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, expires: Date.now() + this.CACHE_TTL });
  }

  async search(query: string, options?: RegistrySearchOptions): Promise<RegistrySkill[]> {
    const limit = sanitizeLimit(options?.limit, 50);
    const cacheKey = `search:${query}:${limit}`;
    const cached = this.getCached<RegistrySkill[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = (await res.json()) as {
        skills?: Array<{
          id: string;
          name: string;
          installs?: number;
          topSource?: string;
        }>;
      };
      const results = (data.skills ?? [])
        .map((s) => ({
          slug: s.id,
          name: s.name || s.id,
          description: `Source: ${s.topSource ?? "unknown"}`,
          downloads: s.installs,
        }))
        .slice(0, limit);
      this.setCache(cacheKey, results);
      return results;
    } catch (err) {
      console.warn(`[skills.sh] Search failed:`, err);
      return [];
    }
  }

  async get(slug: string): Promise<RegistrySkillDetails | null> {
    try {
      const skills = await this.search(slug, { limit: 50 });
      const match = skills.find((s) => s.slug === slug);
      if (!match) return null;
      return {
        ...match,
        version: "latest",
      };
    } catch {
      return null;
    }
  }

  async download(slug: string): Promise<SkillDownload> {
    // First, try to get the source info from search
    const skills = await this.search(slug, { limit: 100 });
    const match = skills.find((s) => s.slug === slug);

    if (!match?.description?.startsWith("Source: ")) {
      throw new Error(`Cannot find source for skill "${slug}"`);
    }

    const source = match.description.replace("Source: ", "");
    // source is like "owner/repo"

    // Use GitHub tree API to find the SKILL.md file for this skill
    try {
      const cacheKey = `tree:${source}`;
      let tree = this.getCached<Array<{ path: string }>>(cacheKey);

      if (!tree) {
        for (const branch of ["main", "master"]) {
          const treeUrl = `https://api.github.com/repos/${source}/git/trees/${branch}?recursive=1`;
          const treeRes = await fetch(treeUrl);
          if (treeRes.ok) {
            const treeData = (await treeRes.json()) as {
              tree?: Array<{ path: string; type: string }>;
            };
            tree = (treeData.tree ?? []).filter((t) => t.type === "blob");
            this.setCache(cacheKey, tree);
            break;
          }
        }
      }

      if (tree) {
        // Find SKILL.md file that matches the slug
        const skillFile =
          tree.find((t) => t.path.endsWith("/SKILL.md") && t.path.includes(slug)) ||
          tree.find((t) => t.path.endsWith(`/${slug}/SKILL.md`)) ||
          tree.find(
            (t) =>
              // Handle cases like skills/username/skillname/SKILL.md
              t.path.endsWith("/SKILL.md") && t.path.toLowerCase().includes(slug.toLowerCase())
          );

        if (skillFile) {
          for (const branch of ["main", "master"]) {
            const contentUrl = `https://raw.githubusercontent.com/${source}/${branch}/${skillFile.path}`;
            const contentRes = await fetch(contentUrl);
            if (contentRes.ok) {
              const content = await contentRes.text();
              return {
                slug,
                version: "latest",
                files: [{ path: "SKILL.md", content }],
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[skills.sh] GitHub tree lookup failed for ${source}:`, err);
    }

    // Fallback: try common path patterns
    const [owner] = source.split("/");
    const slugWithoutPrefix = slug.replace(new RegExp(`^${owner.replace(/-.*$/, "")}-`), "");

    const pathsToTry = [
      `skills/${slug}/SKILL.md`,
      `skills/${slugWithoutPrefix}/SKILL.md`,
      `${slug}/SKILL.md`,
      `${slugWithoutPrefix}/SKILL.md`,
      `SKILL.md`,
    ];

    for (const path of pathsToTry) {
      for (const branch of ["main", "master"]) {
        const githubUrl = `https://raw.githubusercontent.com/${source}/${branch}/${path}`;
        try {
          const res = await fetch(githubUrl);
          if (res.ok) {
            const content = await res.text();
            if (content.includes("---") || content.includes("# ")) {
              return {
                slug,
                version: "latest",
                files: [{ path: "SKILL.md", content }],
              };
            }
          }
        } catch {
          continue;
        }
      }
    }

    throw new Error(
      `Failed to download skill "${slug}" from skills.sh (source: ${source}). SKILL.md not found in repo.`
    );
  }

  /** List popular skills (for browse) */
  async list(options?: RegistryBrowseOptions): Promise<RegistrySkill[]> {
    const limit = sanitizeLimit(options?.limit, 100);
    const cacheKey = `list:${limit}`;
    const cached = this.getCached<RegistrySkill[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/api/skills`;
      const res = await fetch(url);
      if (!res.ok) {
        // If api/skills returns 404, we use the working search API as a fallback to list popular skills
        return await this.search("agent", { limit });
      }
      const data = (await res.json()) as {
        skills?: Array<{
          id: string;
          name: string;
          installs?: number;
          topSource?: string;
        }>;
      };
      const results = (data.skills ?? [])
        .map((s) => ({
          slug: s.id,
          name: s.name || s.id,
          description: `Source: ${s.topSource ?? "unknown"}`,
          downloads: s.installs,
        }))
        .slice(0, limit);
      this.setCache(cacheKey, results);
      return results;
    } catch (err) {
      console.warn(`[skills.sh] List failed:`, err);
      return [];
    }
  }
}

/**
 * CybaraHub Registry Implementation (Future)
 * Our own registry
 */
export class CybaraHubRegistry implements SkillRegistry {
  name = "cybarahub";
  baseUrl = "https://hub.cybara.ai/api";

  async search(query: string, options?: RegistrySearchOptions): Promise<RegistrySkill[]> {
    const limit = sanitizeLimit(options?.limit, 50);
    const url = `${this.baseUrl}/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { skills?: RegistrySkill[] };
    return data.skills ?? [];
  }

  async get(slug: string): Promise<RegistrySkillDetails | null> {
    const url = `${this.baseUrl}/skills/${encodeURIComponent(slug)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json() as Promise<RegistrySkillDetails>;
  }

  async download(slug: string): Promise<SkillDownload> {
    const url = `${this.baseUrl}/skills/${encodeURIComponent(slug)}/download`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download skill: ${slug}`);
    return res.json() as Promise<SkillDownload>;
  }
}

export type RegistryAggregateOptions = {
  registry?: string;
  dedupe?: boolean;
  limit?: number;
  sort?: RegistrySort;
  cursor?: string;
  maxPages?: number;
};

/**
 * Multi-registry manager
 */
export class SkillRegistryManager {
  private registries: Map<string, SkillRegistry> = new Map();
  private defaultRegistry: string;
  private SEARCH_TIMEOUT = 8000; // 8 second timeout per registry (ClawHub can be slow)

  constructor(defaultRegistry = "clawhub") {
    this.defaultRegistry = defaultRegistry;
    // Register default providers (only working ones)
    this.register(new ClawdHubRegistry());
    this.register(new SkillsShRegistry());
    // CybaraHub not registered - doesn't exist yet
  }

  register(registry: SkillRegistry): void {
    this.registries.set(registry.name, registry);
  }

  get(name: string): SkillRegistry | undefined {
    return this.registries.get(name);
  }

  getDefault(): SkillRegistry {
    return this.registries.get(this.defaultRegistry) ?? this.registries.values().next().value!;
  }

  list(): SkillRegistry[] {
    return Array.from(this.registries.values());
  }

  private getTargetRegistries(registryName?: string): SkillRegistry[] {
    if (registryName) {
      const selected = this.get(registryName);
      return selected ? [selected] : [];
    }
    return this.list();
  }

  private normalizeListResult(result: RegistrySkill[] | RegistryListResult): RegistryListResult {
    if (Array.isArray(result)) {
      return { items: result, nextCursor: null };
    }
    return {
      items: result.items ?? [],
      nextCursor: result.nextCursor ?? null,
    };
  }

  private priorityOrder(
    resultsByRegistry: Map<string, Array<RegistrySkill & { registry: string }>>
  ): string[] {
    const knownNames = this.list().map((registry) => registry.name);
    const combined = [this.defaultRegistry, ...knownNames, ...Array.from(resultsByRegistry.keys())];
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const name of combined) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      ordered.push(name);
    }
    return ordered;
  }

  private flattenByPriority(
    resultsByRegistry: Map<string, Array<RegistrySkill & { registry: string }>>
  ): Array<RegistrySkill & { registry: string }> {
    const flattened: Array<RegistrySkill & { registry: string }> = [];
    for (const registryName of this.priorityOrder(resultsByRegistry)) {
      const skills = resultsByRegistry.get(registryName);
      if (skills?.length) {
        flattened.push(...skills);
      }
    }
    return flattened;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  /**
   * Search across all registries
   */
  async searchAll(
    query: string,
    options: RegistryAggregateOptions = {}
  ): Promise<Array<RegistrySkill & { registry: string }>> {
    const resultsByRegistry = new Map<string, Array<RegistrySkill & { registry: string }>>();
    const registries = this.getTargetRegistries(options.registry);
    const limit = sanitizeLimit(options.limit, REGISTRY_DEFAULT_LIMIT);

    await Promise.all(
      registries.map(async (registry) => {
        try {
          const skills = await this.withTimeout(
            registry.search(query, { limit }),
            this.SEARCH_TIMEOUT
          );
          if (skills) {
            resultsByRegistry.set(
              registry.name,
              skills.map((s) => ({ ...s, registry: registry.name }))
            );
          }
        } catch (err) {
          console.warn(`[Registry] ${registry.name} search failed:`, err);
        }
      })
    );

    if (options.dedupe === false) {
      return this.flattenByPriority(resultsByRegistry);
    }

    return this.dedupeByRegistry(resultsByRegistry);
  }

  /**
   * Browse (list) skills from all registries that support it
   */
  async browseAll(
    options: RegistryAggregateOptions = {}
  ): Promise<Array<RegistrySkill & { registry: string }>> {
    const resultsByRegistry = new Map<string, Array<RegistrySkill & { registry: string }>>();
    const registries = this.getTargetRegistries(options.registry);
    const limit = sanitizeLimit(options.limit, REGISTRY_DEFAULT_LIMIT);
    const maxPages = sanitizeMaxPages(options.maxPages);
    const sort = options.sort;
    const initialCursor = options.cursor;

    await Promise.all(
      registries.map(async (registry) => {
        try {
          if (registry.list) {
            const collected: Array<RegistrySkill & { registry: string }> = [];
            let cursor = initialCursor;

            for (let page = 0; page < maxPages; page++) {
              const pageResult = await this.withTimeout(
                registry.list({ limit, sort, cursor }),
                this.SEARCH_TIMEOUT
              );
              if (!pageResult) {
                break;
              }

              const normalized = this.normalizeListResult(pageResult);
              if (normalized.items.length > 0) {
                collected.push(...normalized.items.map((s) => ({ ...s, registry: registry.name })));
              }

              const nextCursor = normalized.nextCursor ?? null;
              if (!nextCursor) {
                break;
              }

              cursor = nextCursor;

              // ClawHub only supports cursor pagination for sort=updated.
              if (sort && sort !== "updated") {
                break;
              }
            }

            if (collected.length > 0) {
              resultsByRegistry.set(registry.name, collected);
            }
          }
        } catch (err) {
          console.warn(`[Registry] ${registry.name} list failed:`, err);
        }
      })
    );

    if (options.dedupe === false) {
      return this.flattenByPriority(resultsByRegistry);
    }

    return this.dedupeByRegistry(resultsByRegistry);
  }

  /**
   * Dedupe skills by slug, preferring default registry order.
   */
  private dedupeByRegistry(
    resultsByRegistry: Map<string, Array<RegistrySkill & { registry: string }>>
  ): Array<RegistrySkill & { registry: string }> {
    const bySlug = new Map<string, RegistrySkill & { registry: string }>();

    for (const registryName of this.priorityOrder(resultsByRegistry)) {
      const skills = resultsByRegistry.get(registryName);
      if (skills) {
        for (const skill of skills) {
          if (!bySlug.has(skill.slug)) {
            bySlug.set(skill.slug, skill);
          }
        }
      }
    }

    return Array.from(bySlug.values());
  }

  /**
   * Install a skill from any registry
   */
  async install(
    slug: string,
    options: {
      registry?: string;
      targetDir?: string;
      allowSuspicious?: boolean;
    } = {}
  ): Promise<{
    success: boolean;
    path?: string;
    error?: string;
    blockedReason?: "malware" | "suspicious";
    requiresConfirmation?: boolean;
  }> {
    const registry = options.registry ? this.get(options.registry) : this.getDefault();

    if (!registry) {
      return { success: false, error: `Unknown registry: ${options.registry}` };
    }

    try {
      const details = await registry.get(slug).catch(() => null);
      const moderation = details?.moderation;
      if (moderation?.isMalwareBlocked) {
        return {
          success: false,
          blockedReason: "malware",
          error: `Blocked: "${slug}" is flagged as malicious by VirusTotal.`,
        };
      }
      if (moderation?.isSuspicious && !options.allowSuspicious) {
        return {
          success: false,
          blockedReason: "suspicious",
          requiresConfirmation: true,
          error: `Warning: "${slug}" is flagged as suspicious by VirusTotal. Confirm to install anyway.`,
        };
      }

      const download = await registry.download(slug);
      const targetDir = options.targetDir ?? join(homedir(), ".cybara", "skills", slug);

      // Create directory
      await mkdir(targetDir, { recursive: true });

      const resolvedTarget = resolve(targetDir);
      for (const file of download.files) {
        const filePath = resolve(targetDir, file.path);
        if (filePath !== resolvedTarget && !filePath.startsWith(resolvedTarget + sep)) {
          return {
            success: false,
            error: `Refusing to write skill file outside the skill directory: ${file.path}`,
          };
        }
        await mkdir(join(filePath, ".."), { recursive: true });
        await writeFile(filePath, file.content, "utf-8");
      }

      // Write metadata
      const metadataPath = join(targetDir, ".registry.json");
      await writeFile(
        metadataPath,
        JSON.stringify(
          {
            slug,
            version: download.version,
            registry: registry.name,
            installedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf-8"
      );

      return { success: true, path: targetDir };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Get workspace path for skills directory
   */
  private getWorkspaceSkillsDir(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Handle bunfs paths (production builds)
    if (__dirname.startsWith("/$bunfs") || __dirname.includes("$bunfs")) {
      const execDir = dirname(process.execPath);
      return join(execDir, "..", "..", "skills");
    }
    return join(__dirname, "..", "..", "..", "skills");
  }

  /**
   * Find skill directory or file by looking in all possible locations
   */
  private async findSkillPath(slug: string): Promise<string | null> {
    // Normalize slug for comparison
    const normalizedSlug = slug.toLowerCase().replace(/[\s_]+/g, "-");

    // Check possible locations in order of priority
    const possibleDirs = [
      join(homedir(), ".cybara", "skills"), // User-installed
      this.getWorkspaceSkillsDir(), // Workspace skills
    ];

    for (const skillsDir of possibleDirs) {
      try {
        // Check if directory exists
        if (!existsSync(skillsDir)) continue;

        const entries = await readdir(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() && !(entry.isFile() && entry.name.endsWith(".md"))) continue;

          const baseName =
            entry.isFile() && entry.name.endsWith(".md") ? entry.name.slice(0, -3) : entry.name;

          // Compare normalized names
          const entryNormalized = baseName.toLowerCase().replace(/[\s_]+/g, "-");
          if (entryNormalized === normalizedSlug || baseName === slug) {
            return join(skillsDir, entry.name);
          }
        }
      } catch {
        // Skip this directory if we can't read it
        continue;
      }
    }

    return null;
  }

  /**
   * Uninstall a skill
   */
  async uninstall(
    slug: string,
    options: { targetDir?: string } = {}
  ): Promise<{ success: boolean; error?: string; location?: string }> {
    // If targetDir is explicitly specified, use it
    if (options.targetDir) {
      try {
        await rm(options.targetDir, { recursive: true, force: true });
        return { success: true, location: options.targetDir };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }

    // Otherwise, search for the skill in all possible locations
    const skillPath = await this.findSkillPath(slug);

    if (!skillPath) {
      return { success: false, error: `Skill not found: ${slug}` };
    }

    try {
      await rm(skillPath, { recursive: true, force: true });
      return { success: true, location: skillPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Update all installed skills
   */
  /**
   * Get all skills directories to check for updates
   */
  private getSkillsDirs(): string[] {
    const dirs: string[] = [join(homedir(), ".cybara", "skills")];

    // Add workspace skills directory
    const workspaceDir = this.getWorkspaceSkillsDir();
    if (!dirs.includes(workspaceDir)) {
      dirs.push(workspaceDir);
    }

    return dirs;
  }

  async updateAll(
    options: { skillsDir?: string } = {}
  ): Promise<Array<{ slug: string; updated: boolean; error?: string }>> {
    const targetDir = options.skillsDir ?? null;
    const skillsDirs = targetDir ? [targetDir] : this.getSkillsDirs();
    const results: Array<{ slug: string; updated: boolean; error?: string }> = [];

    for (const skillsDir of skillsDirs) {
      // Find all installed skills with registry metadata
      try {
        if (!existsSync(skillsDir)) continue;

        const dirs = await readdir(skillsDir, { withFileTypes: true });

        for (const dir of dirs) {
          if (!dir.isDirectory()) continue;

          const metadataPath = join(skillsDir, dir.name, ".registry.json");
          try {
            const metadata = JSON.parse(await readFile(metadataPath, "utf-8")) as {
              slug: string;
              version: string;
              registry: string;
            };

            const registry = this.get(metadata.registry);
            if (!registry) {
              results.push({ slug: dir.name, updated: false, error: "Unknown registry" });
              continue;
            }

            const latest = await registry.get(metadata.slug);
            if (!latest) {
              results.push({ slug: dir.name, updated: false, error: "Not found in registry" });
              continue;
            }

            if (latest.version !== metadata.version) {
              const installResult = await this.install(metadata.slug, {
                registry: metadata.registry,
                targetDir: join(skillsDir, dir.name),
              });
              results.push({
                slug: dir.name,
                updated: installResult.success,
                error: installResult.error,
              });
            } else {
              results.push({ slug: dir.name, updated: false }); // Already up to date
            }
          } catch {
            // No metadata file, skip
          }
        }
      } catch {
        // Skills directory doesn't exist, skip
      }
    }

    return results;
  }
}

// Default manager instance
export const registryManager = new SkillRegistryManager("clawhub");
