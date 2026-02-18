/**
 * Skills Registry
 * Multi-registry compatible skill install/sync (ClawdHub, skills.sh, CybaraHub)
 */

import { mkdir, writeFile, readFile, rm, readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Registry provider interface
 * Implement this for each registry (ClawdHub, skills.sh, CybaraHub)
 */
export interface SkillRegistry {
    name: string;
    baseUrl: string;

    /** Search for skills by query */
    search(query: string): Promise<RegistrySkill[]>;

    /** Get skill details by slug/name */
    get(slug: string): Promise<RegistrySkillDetails | null>;

    /** Download skill content */
    download(slug: string): Promise<SkillDownload>;

    /** List popular/recent skills (for browse) */
    list?(): Promise<RegistrySkill[]>;

    /** Check for updates to installed skills */
    checkUpdates?(installed: InstalledSkillInfo[]): Promise<UpdateInfo[]>;
}

export type RegistrySkill = {
    slug: string;
    name: string;
    description: string;
    author?: string;
    downloads?: number;
    stars?: number;
    tags?: string[];
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

/**
 * ClawdHub Registry Implementation
 * https://clawhub.ai - Official Cybara skill registry
 */
export class ClawdHubRegistry implements SkillRegistry {
    name = "clawhub";
    baseUrl = "https://www.clawhub.ai";

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

    async search(query: string): Promise<RegistrySkill[]> {
        const cacheKey = `search:${query}`;
        const cached = this.getCached<RegistrySkill[]>(cacheKey);
        if (cached) return cached;

        try {
            const url = `${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json() as {
                results?: Array<{
                    slug?: string;
                    displayName?: string;
                    summary?: string | null;
                    version?: string | null;
                    score?: number;
                    updatedAt?: number;
                }>;
            };
            const results = (data.results ?? []).map(r => ({
                slug: r.slug ?? "",
                name: r.displayName ?? r.slug ?? "",
                description: r.summary ?? "",
                version: r.version ?? undefined,
            })).filter(r => r.slug);
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
            const data = await res.json() as {
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
            };
            if (!data.skill) return null;
            return {
                slug: data.skill.slug,
                name: data.skill.displayName,
                description: data.skill.summary ?? "",
                version: data.latestVersion?.version ?? "latest",
                author: data.owner?.displayName ?? data.owner?.handle ?? undefined,
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

            // Unzip using bun/system
            const unzipResult = Bun.spawnSync(["unzip", "-o", zipPath, "-d", tempDir], {
                stdout: "ignore",
                stderr: "pipe",
            });
            if ((unzipResult.exitCode ?? 1) !== 0) {
                const unzipError = unzipResult.stderr.toString().trim();
                throw new Error(unzipError || `Failed to extract ZIP for: ${slug}`);
            }

            // Find and read skill file (case-insensitive, also check for skill.json)
            const files = await readdir(tempDir, { recursive: true });
            const allFiles: string[] = [];
            for (const f of files) {
                if (typeof f === 'string') allFiles.push(f);
            }

            // Look for skill.md (case insensitive) or skill.json
            const skillMdPath = allFiles.find(f =>
                f.toLowerCase().endsWith("skill.md")
            );
            const skillJsonPath = allFiles.find(f =>
                f.toLowerCase().endsWith("skill.json")
            );

            // Get version from filename if available
            const disposition = res.headers.get("content-disposition");
            const versionMatch = disposition?.match(/(\d+\.\d+\.\d+)/);

            if (skillMdPath) {
                const content = await readFile(join(tempDir, skillMdPath), "utf-8");
                await rm(tempDir, { recursive: true, force: true }).catch(() => { });
                return {
                    slug,
                    version: versionMatch?.[1] ?? "latest",
                    files: [{ path: "SKILL.md", content }],
                };
            }

            // If no skill.md but has skill.json, read all .md files as skill content
            if (skillJsonPath) {
                const mdFiles = allFiles.filter(f => f.toLowerCase().endsWith(".md"));
                const fileContents: Array<{ path: string; content: string }> = [];

                for (const mdFile of mdFiles) {
                    const content = await readFile(join(tempDir, mdFile), "utf-8");
                    fileContents.push({ path: mdFile, content });
                }

                await rm(tempDir, { recursive: true, force: true }).catch(() => { });

                if (fileContents.length > 0) {
                    return {
                        slug,
                        version: versionMatch?.[1] ?? "latest",
                        files: fileContents,
                    };
                }
            }

            await rm(tempDir, { recursive: true, force: true }).catch(() => { });
            throw new Error(`No skill files found in ZIP for: ${slug}`);
        }

        // Fallback to JSON response (old behavior)
        return res.json() as Promise<SkillDownload>;
    }

    /** List recent skills (for browse) */
    async list(): Promise<RegistrySkill[]> {
        const cacheKey = "list";
        const cached = this.getCached<RegistrySkill[]>(cacheKey);
        if (cached) return cached;

        try {
            const url = `${this.baseUrl}/api/v1/skills`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json() as {
                items?: Array<{
                    slug: string;
                    displayName: string;
                    summary?: string | null;
                    stats?: { downloads?: number; stars?: number };
                    latestVersion?: { version: string } | null;
                }>;
            };
            const results = (data.items ?? []).map(s => ({
                slug: s.slug,
                name: s.displayName,
                description: s.summary ?? "",
                downloads: s.stats?.downloads,
                stars: s.stats?.stars,
                version: s.latestVersion?.version,
            }));
            this.setCache(cacheKey, results);
            return results;
        } catch (err) {
            console.warn(`[ClawHub] List failed:`, err);
            return [];
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

    async search(query: string): Promise<RegistrySkill[]> {
        const cacheKey = `search:${query}`;
        const cached = this.getCached<RegistrySkill[]>(cacheKey);
        if (cached) return cached;

        try {
            const url = `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json() as {
                skills?: Array<{
                    id: string;
                    name: string;
                    installs?: number;
                    topSource?: string;
                }>;
            };
            const results = (data.skills ?? []).map(s => ({
                slug: s.id,
                name: s.name || s.id,
                description: `Source: ${s.topSource ?? "unknown"}`,
                downloads: s.installs,
            }));
            this.setCache(cacheKey, results);
            return results;
        } catch (err) {
            console.warn(`[skills.sh] Search failed:`, err);
            return [];
        }
    }

    async get(slug: string): Promise<RegistrySkillDetails | null> {
        try {
            const skills = await this.search(slug);
            const match = skills.find(s => s.slug === slug);
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
        const skills = await this.search(slug);
        const match = skills.find(s => s.slug === slug);

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
                const treeUrl = `https://api.github.com/repos/${source}/git/trees/main?recursive=1`;
                const treeRes = await fetch(treeUrl);
                if (treeRes.ok) {
                    const treeData = await treeRes.json() as { tree?: Array<{ path: string; type: string }> };
                    tree = (treeData.tree ?? []).filter(t => t.type === "blob");
                    this.setCache(cacheKey, tree);
                }
            }

            if (tree) {
                // Find SKILL.md file that matches the slug
                const skillFile = tree.find(t =>
                    t.path.endsWith("/SKILL.md") && t.path.includes(slug)
                ) || tree.find(t =>
                    t.path.endsWith(`/${slug}/SKILL.md`)
                ) || tree.find(t =>
                    // Handle cases like skills/username/skillname/SKILL.md
                    t.path.endsWith("/SKILL.md") && t.path.toLowerCase().includes(slug.toLowerCase())
                );

                if (skillFile) {
                    const contentUrl = `https://raw.githubusercontent.com/${source}/main/${skillFile.path}`;
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
            const githubUrl = `https://raw.githubusercontent.com/${source}/main/${path}`;
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

        throw new Error(`Failed to download skill "${slug}" from skills.sh (source: ${source}). SKILL.md not found in repo.`);
    }

    /** List popular skills (for browse) */
    async list(): Promise<RegistrySkill[]> {
        const cacheKey = "list";
        const cached = this.getCached<RegistrySkill[]>(cacheKey);
        if (cached) return cached;

        try {
            const url = `${this.baseUrl}/api/skills`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json() as {
                skills?: Array<{
                    id: string;
                    name: string;
                    installs?: number;
                    topSource?: string;
                }>;
            };
            const results = (data.skills ?? []).map(s => ({
                slug: s.id,
                name: s.name || s.id,
                description: `Source: ${s.topSource ?? "unknown"}`,
                downloads: s.installs,
            }));
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

    async search(query: string): Promise<RegistrySkill[]> {
        const url = `${this.baseUrl}/skills/search?q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json() as { skills?: RegistrySkill[] };
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
    async searchAll(query: string): Promise<Array<RegistrySkill & { registry: string }>> {
        const resultsByRegistry = new Map<string, Array<RegistrySkill & { registry: string }>>();

        await Promise.all(
            this.list().map(async (registry) => {
                try {
                    const skills = await this.withTimeout(registry.search(query), this.SEARCH_TIMEOUT);
                    if (skills) {
                        resultsByRegistry.set(registry.name, skills.map(s => ({ ...s, registry: registry.name })));
                    }
                } catch (err) {
                    console.warn(`[Registry] ${registry.name} search failed:`, err);
                }
            })
        );

        // Dedupe by slug, prefer clawhub over skills.sh
        return this.dedupeByRegistry(resultsByRegistry);
    }

    /**
     * Browse (list) skills from all registries that support it
     */
    async browseAll(): Promise<Array<RegistrySkill & { registry: string }>> {
        const resultsByRegistry = new Map<string, Array<RegistrySkill & { registry: string }>>();

        await Promise.all(
            this.list().map(async (registry) => {
                try {
                    if (registry.list) {
                        const skills = await this.withTimeout(registry.list(), this.SEARCH_TIMEOUT);
                        if (skills) {
                            resultsByRegistry.set(registry.name, skills.map(s => ({ ...s, registry: registry.name })));
                        }
                    }
                } catch (err) {
                    console.warn(`[Registry] ${registry.name} list failed:`, err);
                }
            })
        );

        // Dedupe by slug, prefer clawhub over skills.sh
        return this.dedupeByRegistry(resultsByRegistry);
    }

    /**
     * Dedupe skills by slug, preferring clawhub registry
     */
    private dedupeByRegistry(resultsByRegistry: Map<string, Array<RegistrySkill & { registry: string }>>): Array<RegistrySkill & { registry: string }> {
        const bySlug = new Map<string, RegistrySkill & { registry: string }>();

        // Priority order - clawhub first (preferred)
        const priorityOrder = ["clawhub", "skills.sh"];

        for (const registryName of priorityOrder) {
            const skills = resultsByRegistry.get(registryName);
            if (skills) {
                for (const skill of skills) {
                    // Only add if not already present (earlier registry wins)
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
        } = {}
    ): Promise<{ success: boolean; path?: string; error?: string }> {
        const registry = options.registry
            ? this.get(options.registry)
            : this.getDefault();

        if (!registry) {
            return { success: false, error: `Unknown registry: ${options.registry}` };
        }

        try {
            const download = await registry.download(slug);
            const targetDir = options.targetDir ?? join(homedir(), ".cybara", "skills", slug);

            // Create directory
            await mkdir(targetDir, { recursive: true });

            // Write files
            for (const file of download.files) {
                const filePath = join(targetDir, file.path);
                await mkdir(join(filePath, ".."), { recursive: true });
                await writeFile(filePath, file.content, "utf-8");
            }

            // Write metadata
            const metadataPath = join(targetDir, ".registry.json");
            await writeFile(metadataPath, JSON.stringify({
                slug,
                version: download.version,
                registry: registry.name,
                installedAt: new Date().toISOString(),
            }, null, 2), "utf-8");

            return { success: true, path: targetDir };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    /**
     * Uninstall a skill
     */
    async uninstall(
        slug: string,
        options: { targetDir?: string } = {}
    ): Promise<{ success: boolean; error?: string }> {
        const targetDir = options.targetDir ?? join(homedir(), ".cybara", "skills", slug);

        try {
            await rm(targetDir, { recursive: true, force: true });
            return { success: true };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    /**
     * Update all installed skills
     */
    async updateAll(options: {
        skillsDir?: string;
    } = {}): Promise<Array<{ slug: string; updated: boolean; error?: string }>> {
        const skillsDir = options.skillsDir ?? join(homedir(), ".cybara", "skills");
        const results: Array<{ slug: string; updated: boolean; error?: string }> = [];

        // Find all installed skills with registry metadata

        try {
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
            // Skills directory doesn't exist
        }

        return results;
    }
}

// Default manager instance
export const registryManager = new SkillRegistryManager("clawhub");
