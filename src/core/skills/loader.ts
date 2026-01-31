/**
 * Skills Loader
 * Discovers and parses SKILL.md files from skill directories
 */

import { readdir, readFile, stat, watch } from "fs/promises";
import { join, resolve, basename, dirname } from "path";
import { homedir, platform } from "os";
import type {
    Skill,
    SkillEntry,
    SkillFrontmatter,
    SkillMetadata,
    SkillInvocationPolicy,
    SkillsConfig,
} from "./types";

const SKILL_FILENAME = "SKILL.md";

/**
 * Parse YAML frontmatter from markdown content
 * OpenClaw uses single-line values in frontmatter
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
    const lines = content.split("\n");

    if (lines[0]?.trim() !== "---") {
        return { frontmatter: {}, body: content };
    }

    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === "---") {
            endIndex = i;
            break;
        }
    }

    if (endIndex === -1) {
        return { frontmatter: {}, body: content };
    }

    const frontmatterLines = lines.slice(1, endIndex);
    const body = lines.slice(endIndex + 1).join("\n").trim();

    const frontmatter: Record<string, unknown> = {};

    for (let i = 0; i < frontmatterLines.length; i++) {
        const line = frontmatterLines[i];
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;

        const key = line.slice(0, colonIndex).trim();
        let value: unknown = line.slice(colonIndex + 1).trim();

        // Handle YAML multiline string (|)
        if (value === "|" || value === ">") {
            // Collect indented lines that follow
            const multilineContent: string[] = [];
            let baseIndent = -1;

            for (let j = i + 1; j < frontmatterLines.length; j++) {
                const nextLine = frontmatterLines[j];

                // Check if line starts with whitespace (continuation)
                const leadingSpaces = nextLine.match(/^(\s*)/)?.[1].length ?? 0;

                // If line has no leading space and contains a colon, it's a new key
                if (leadingSpaces === 0 && nextLine.includes(":")) {
                    break;
                }

                // Set base indent from first content line
                if (baseIndent === -1 && nextLine.trim()) {
                    baseIndent = leadingSpaces;
                }

                // Add line content (strip base indentation)
                if (baseIndent !== -1) {
                    multilineContent.push(nextLine.slice(baseIndent).trimEnd());
                }
                i = j; // Skip these lines in outer loop
            }

            value = multilineContent.join(" ").trim();
        } else if (typeof value === "string") {
            // Handle quoted strings
            let strValue: string = value;

            if ((strValue.startsWith('"') && strValue.endsWith('"')) ||
                (strValue.startsWith("'") && strValue.endsWith("'"))) {
                strValue = strValue.slice(1, -1);
            }

            // Parse JSON for metadata field
            if (key === "metadata" && strValue.startsWith("{")) {
                try {
                    value = JSON.parse(strValue);
                } catch {
                    // Keep as string if invalid JSON
                    value = strValue;
                }
            } else if (strValue === "true") {
                value = true;
            } else if (strValue === "false") {
                value = false;
            } else {
                value = strValue;
            }
        }

        frontmatter[key] = value;
    }

    return { frontmatter, body };
}

/**
 * Parse a SKILL.md file into a SkillEntry
 */
export function parseSkillFile(content: string, filePath: string, source: SkillEntry["source"]): SkillEntry | null {
    const { frontmatter, body } = parseFrontmatter(content);

    let name = frontmatter.name as string | undefined;
    let description = frontmatter.description as string | undefined;

    // Fallback: extract name from first # heading in body
    if (!name) {
        const headingMatch = body.match(/^#\s+(.+?)(?:\s*[-–—]\s*.+)?$/m);
        if (headingMatch) {
            name = headingMatch[1].trim();
        }
    }

    // Fallback: extract description from first non-empty paragraph after heading
    if (!description && body) {
        // Split by double newlines to get paragraphs
        const paragraphs = body.split(/\n\n+/);
        for (const para of paragraphs) {
            const trimmed = para.trim();
            // Skip headings, code blocks, and empty lines
            if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```') && !trimmed.startsWith('|')) {
                description = trimmed.slice(0, 200); // First 200 chars
                break;
            }
        }
    }

    if (!name || !description) {
        console.warn(`[Skills] Invalid SKILL.md at ${filePath}: missing name or description`);
        return null;
    }

    // Extract metadata from frontmatter
    const rawMetadata = frontmatter.metadata as Record<string, unknown> | undefined;
    const metadata: SkillMetadata | undefined = rawMetadata?.moltbot as SkillMetadata
        ?? rawMetadata?.clawdbot as SkillMetadata
        ?? rawMetadata?.cybara as SkillMetadata
        ?? undefined;

    // Build invocation policy
    const invocation: SkillInvocationPolicy = {
        userInvocable: frontmatter["user-invocable"] !== false,
        disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    };

    const skill: Skill = {
        name,
        description,
        location: dirname(filePath),
        instructions: body,
    };

    return {
        skill,
        frontmatter: frontmatter as SkillFrontmatter,
        metadata,
        invocation,
        filePath,
        source,
    };
}

/**
 * Scan a directory for SKILL.md files
 */
export async function scanSkillsDirectory(
    dir: string,
    source: SkillEntry["source"]
): Promise<SkillEntry[]> {
    const skills: SkillEntry[] = [];

    try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillPath = join(dir, entry.name, SKILL_FILENAME);

            try {
                const content = await readFile(skillPath, "utf-8");
                const skillEntry = parseSkillFile(content, skillPath, source);
                if (skillEntry) {
                    skills.push(skillEntry);
                }
            } catch {
                // SKILL.md doesn't exist in this subdirectory
            }
        }
    } catch {
        // Directory doesn't exist
    }

    return skills;
}

/**
 * Get default skill directory paths
 */
export function getSkillDirectories(workspaceDir?: string): {
    bundled: string;
    local: string;
    workspace: string | null;
} {
    return {
        bundled: resolve(__dirname, "../../../skills"),
        local: join(homedir(), ".cybara", "skills"),
        workspace: workspaceDir ? join(workspaceDir, "skills") : null,
    };
}

/**
 * Load all skills with proper precedence
 * Workspace > Local > Bundled
 */
export async function loadAllSkills(options: {
    workspaceDir?: string;
    extraDirs?: string[];
    config?: SkillsConfig;
}): Promise<SkillEntry[]> {
    const dirs = getSkillDirectories(options.workspaceDir);
    const skillsByName = new Map<string, SkillEntry>();

    // Load in precedence order (lowest first, higher overwrites)

    // 1. Extra dirs (lowest priority)
    for (const dir of options.extraDirs ?? options.config?.load?.extraDirs ?? []) {
        const resolved = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
        const skills = await scanSkillsDirectory(resolved, "bundled");
        for (const skill of skills) {
            skillsByName.set(skill.skill.name, skill);
        }
    }

    // 2. Bundled skills
    const bundledSkills = await scanSkillsDirectory(dirs.bundled, "bundled");
    for (const skill of bundledSkills) {
        // Check allowlist
        const allowlist = options.config?.allowBundled;
        if (allowlist && !allowlist.includes(skill.skill.name)) {
            continue;
        }
        skillsByName.set(skill.skill.name, skill);
    }

    // 3. Local skills (~/.cybara/skills)
    const localSkills = await scanSkillsDirectory(dirs.local, "local");
    for (const skill of localSkills) {
        skillsByName.set(skill.skill.name, skill);
    }

    // 4. Workspace skills (highest priority)
    if (dirs.workspace) {
        const workspaceSkills = await scanSkillsDirectory(dirs.workspace, "workspace");
        for (const skill of workspaceSkills) {
            skillsByName.set(skill.skill.name, skill);
        }
    }

    return Array.from(skillsByName.values());
}

/**
 * Check if a skill is enabled in config
 */
export function isSkillEnabled(skillName: string, config?: SkillsConfig): boolean {
    const entry = config?.entries?.[skillName];
    if (entry?.enabled === false) return false;
    return true;
}

/**
 * Watch skill directories for changes
 */
export async function watchSkillDirectories(
    options: {
        workspaceDir?: string;
        config?: SkillsConfig;
        onReload: (skills: SkillEntry[]) => void;
    }
): Promise<{ close: () => void }> {
    const dirs = getSkillDirectories(options.workspaceDir);
    const debounceMs = options.config?.load?.watchDebounceMs ?? 250;

    const controllers: AbortController[] = [];
    let debounceTimer: NodeJS.Timeout | null = null;

    const reload = async () => {
        const skills = await loadAllSkills({
            workspaceDir: options.workspaceDir,
            config: options.config,
        });
        options.onReload(skills);
    };

    const handleChange = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(reload, debounceMs);
    };

    const watchDir = async (dir: string) => {
        try {
            await stat(dir); // Check if exists
            const controller = new AbortController();
            controllers.push(controller);

            const watcher = watch(dir, { recursive: true, signal: controller.signal });

            (async () => {
                try {
                    for await (const event of watcher) {
                        if (event.filename?.endsWith(SKILL_FILENAME)) {
                            handleChange();
                        }
                    }
                } catch (err) {
                    if ((err as NodeJS.ErrnoException).name !== "AbortError") {
                        console.error(`[Skills] Watch error for ${dir}:`, err);
                    }
                }
            })();
        } catch {
            // Directory doesn't exist yet
        }
    };

    // Watch all directories
    watchDir(dirs.bundled);
    watchDir(dirs.local);
    if (dirs.workspace) watchDir(dirs.workspace);
    for (const dir of options.config?.load?.extraDirs ?? []) {
        const resolved = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
        watchDir(resolved);
    }

    return {
        close: () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            for (const controller of controllers) {
                controller.abort();
            }
        },
    };
}

/**
 * Format skills list for system prompt (OpenClaw XML format)
 */
export function formatSkillsForPrompt(skills: SkillEntry[]): string {
    if (skills.length === 0) return "";

    const lines = [
        "<available_skills>",
    ];

    for (const { skill } of skills) {
        const escapedName = escapeXml(skill.name);
        const escapedDesc = escapeXml(skill.description);
        const escapedLoc = escapeXml(skill.location);
        lines.push(`<skill name="${escapedName}" description="${escapedDesc}" location="${escapedLoc}" />`);
    }

    lines.push("</available_skills>");
    return lines.join("\n");
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
