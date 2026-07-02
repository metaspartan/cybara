import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, dirname, basename, extname, resolve } from "path";
import { fileURLToPath } from "url";
import { listInstalledPlugins } from "../plugins";
import { handleCalc, handleConvert } from "./calc";
import { handlePdf } from "./pdf";
import { handleOcr, handleImageDescribe } from "./ocr";
import { parseSkillFile } from "./loader";
import { cybaraDir } from "../paths";

export type {
  SkillInstallSpec,
  SkillMetadata,
  SkillInvocationPolicy,
  SkillCommandDispatch,
  SkillCommandSpec,
  SkillFrontmatter,
  Skill as CybaraSkill,
  SkillEntry,
  SkillEligibilityContext,
  SkillStatus,
  SkillSnapshot,
  SkillsConfig,
  SkillsInstallPreferences,
} from "./types";

export {
  parseFrontmatter,
  parseSkillFile,
  scanSkillsDirectory,
  getSkillDirectories,
  loadAllSkills,
  isSkillEnabled,
  watchSkillDirectories,
  formatSkillsForPrompt,
} from "./loader";

export {
  hasBinary,
  hasEnvVar,
  hasConfigPath,
  createEligibilityContext,
  checkSkillEligibility,
  filterEligibleSkills,
  getSkillsStatusReport,
} from "./gating";

export type {
  SkillRegistry,
  RegistrySkill,
  RegistrySkillDetails,
  SkillDownload,
  InstalledSkillInfo,
  UpdateInfo,
} from "./registry";

export {
  ClawdHubRegistry,
  SkillsShRegistry,
  CybaraHubRegistry,
  SkillRegistryManager,
  registryManager,
} from "./registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const getWorkspacePath = (): string => {
  if (__dirname.startsWith("/$bunfs") || __dirname.includes("$bunfs")) {
    const execDir = dirname(process.execPath);
    return resolve(execDir, "..");
  }
  return join(__dirname, "..", "..", "..");
};
const workspace = getWorkspacePath();

export interface Skill {
  name: string;
  description: string;
  location: string;
  category: string;
  enabled: boolean;
}

export interface SkillDefinition {
  description: string;
  location: string;
  category: string;
}

const defaultSkills: SkillDefinition[] = [
];

let skillsCache: Skill[] | null = null;

function loadSkillFromFile(skillPath: string): Skill | null {
  if (!existsSync(skillPath)) {
    return null;
  }

  try {
    const content = readFileSync(skillPath, "utf-8");
    const folderName = basename(dirname(skillPath)).replace(/-/g, " ");
    const category = "custom";

    let name = folderName;
    let description = "";

    const parsed = parseSkillFile(content, skillPath, "workspace");
    if (parsed) {
      name = parsed.skill.name;
      description = parsed.skill.description;
    } else {
      const headingMatch = content.match(/^#\s+(.+?)(?:\s*[-–—]\s*.+)?$/m);
      if (headingMatch) {
        name = headingMatch[1].trim();
      }

      const bodyDescMatch = content.match(/#\s+([^\n]+)\n([^#]+)/);
      if (bodyDescMatch) {
        description = bodyDescMatch[2].trim().slice(0, 200);
      }
    }

    return {
      name,
      description: description || basename(skillPath),
      location: skillPath,
      category,
      enabled: true,
    };
  } catch {
    return null;
  }
}

export function getSkills(): Skill[] {
  if (skillsCache) {
    return skillsCache;
  }

  const skills: Skill[] = [];

  for (const def of defaultSkills) {
    const skill = loadSkillFromFile(def.location);
    if (skill) {
      skill.description = def.description;
      skill.category = def.category;
      skills.push(skill);
    }
  }

  const skillsDir = join(workspace, "skills");
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir);
    for (const entry of entries) {
      const skillPath = join(skillsDir, entry, "SKILL.md");
      if (existsSync(skillPath)) {
        const skill = loadSkillFromFile(skillPath);
        if (skill && !skills.find((s) => s.name === skill.name)) {
          skills.push(skill);
        }
      }
    }
  }

  const localSkillsDir = join(cybaraDir, "skills");
  if (existsSync(localSkillsDir)) {
    const entries = readdirSync(localSkillsDir);
    for (const entry of entries) {
      const skillPath = join(localSkillsDir, entry, "SKILL.md");
      if (existsSync(skillPath)) {
        const skill = loadSkillFromFile(skillPath);
        if (skill && !skills.find((s) => s.name === skill.name)) {
          skill.category = "installed";
          skills.push(skill);
        }
      }
    }
  }

  for (const plugin of listInstalledPlugins()) {
    for (const dir of plugin.skillDirs) {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const skillPath = join(dir, entry, "SKILL.md");
        if (!existsSync(skillPath)) {
          continue;
        }
        const skill = loadSkillFromFile(skillPath);
        if (skill && !skills.find((s) => s.name === skill.name)) {
          skill.category = "plugin";
          skills.push(skill);
        }
      }
    }
  }

  skillsCache = skills;
  return skills;
}

export function getSkill(name: string): Skill | undefined {
  const skills = getSkills();
  const normalizedName = name.toLowerCase().trim().replace(/[\s_]+/g, "-");
  return skills.find(
    (s) =>
      s.name.toLowerCase().trim().replace(/[\s_]+/g, "-") === normalizedName ||
      basename(dirname(s.location)).toLowerCase().trim().replace(/[\s_]+/g, "-") === normalizedName ||
      basename(s.location, extname(s.location)).toLowerCase().trim().replace(/[\s_]+/g, "-") === normalizedName
  );
}

export function getSkillsByCategory(category: string): Skill[] {
  return getSkills().filter((s) => s.category === category);
}

export function getSkillCategories(): string[] {
  const categories = new Set(getSkills().map((s) => s.category));
  return Array.from(categories);
}

export function clearSkillsCache(): void {
  skillsCache = null;
}

function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSkillContent(name: string, description: string | undefined, content: string): string {
  const trimmed = content.trim();

  if (trimmed.startsWith("---") || trimmed.startsWith("#")) {
    return `${trimmed}\n`;
  }

  const header = description?.trim()
    ? `# ${name}\n\n${description.trim()}\n\n`
    : `# ${name}\n\n`;
  return `${header}${trimmed}\n`;
}

export function createLocalSkill(data: {
  name: string;
  description?: string;
  content: string;
  category?: string;
  slug?: string;
}): { success: boolean; path?: string; slug?: string; error?: string } {
  const name = data.name?.trim();
  const content = data.content?.trim();
  const slug = slugifySkillName(data.slug || name);

  if (!name) return { success: false, error: "Validation error: Skill name is required" };
  if (!content) return { success: false, error: "Validation error: Skill content is required" };
  if (!slug) return { success: false, error: "Validation error: Invalid skill name" };

  const skillsRoot = join(cybaraDir, "skills");
  const targetDir = join(skillsRoot, slug);
  const skillPath = join(targetDir, "SKILL.md");

  if (existsSync(skillPath)) {
    return { success: false, error: `Skill already exists: ${slug}` };
  }

  try {
    mkdirSync(targetDir, { recursive: true });
    const normalizedContent = normalizeSkillContent(name, data.description, content);
    writeFileSync(skillPath, normalizedContent, "utf-8");
    clearSkillsCache();
    return { success: true, path: targetDir, slug };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export interface SkillExecutor {
  (args: Record<string, unknown>): Promise<unknown>;
}

const builtinExecutors: Record<string, SkillExecutor> = {
  calc: handleCalc,
  calculate: handleCalc,
  convert: handleConvert,
  unit_convert: handleConvert,

  pdf: handlePdf,
  pdf_extract: handlePdf,

  ocr: handleOcr,
  image_to_text: handleOcr,
  image_describe: handleImageDescribe,
};

builtinExecutors.weather = async (args: Record<string, unknown>) => {
  const location = (args.location as string) || "";
  const format = (args.format as string) || "short";

  try {
    const urlPath = location ? encodeURIComponent(location) : "";
    const formatParam = format === "detailed" ? "?format=j1" : format === "forecast" ? "?format=j1" : "?format=3";

    const response = await fetch(`https://wttr.in/${urlPath}${formatParam}`);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    if (format === "detailed" || format === "forecast") {
      const data = await response.json() as {
        nearest_area?: Array<{ areaName?: Array<{ value?: string }> }>;
        current_condition?: unknown[];
        weather?: unknown[];
      };
      return {
        location: data.nearest_area?.[0]?.areaName?.[0]?.value || location,
        current: data.current_condition?.[0] || {},
        forecast: format === "forecast" ? data.weather?.slice(0, 5) : undefined,
      };
    }

    const text = await response.text();
    return { weather: text.trim(), location: location || "current location" };
  } catch (error) {
    return { error: (error as Error).message, location };
  }
};

builtinExecutors.summarization = async (args: Record<string, unknown>) => {
  const text = args.text as string;
  const maxLength = (args.maxLength as number) || 200;
  const style = (args.style as string) || "brief";

  if (!text) {
    throw new Error("Text is required for summarization");
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  if (style === "bullet") {
    const keyPoints = sentences.slice(0, Math.min(5, sentences.length));
    return {
      summary: keyPoints.map(s => `• ${s.trim()}`).join("\n"),
      style: "bullet",
      originalLength: text.length,
    };
  }

  const targetSentences = style === "detailed"
    ? Math.ceil(sentences.length * 0.4)
    : Math.ceil(maxLength / 80);

  const summary = sentences.slice(0, targetSentences).join(" ").slice(0, maxLength);

  return {
    summary: summary + (summary.length >= maxLength ? "..." : ""),
    style,
    originalLength: text.length,
    summaryLength: summary.length,
  };
};

builtinExecutors.video_frames = async (args: Record<string, unknown>) => {
  const video = args.video as string;
  // Coerce to safe, bounded positive integers. These are interpolated into the
  // ffmpeg invocation, so non-numeric input must never reach the command.
  const toPosInt = (v: unknown, def: number, max: number): number => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
  };
  const interval = toPosInt(args.interval, 10, 86_400);
  const count = toPosInt(args.count, 5, 10_000);
  const output = (args.output as string) || "/tmp/frames";

  if (!video) {
    throw new Error("Video path is required");
  }

  if (!existsSync(video)) {
    throw new Error(`Video file not found: ${video}`);
  }

  if (!existsSync(output)) {
    mkdirSync(output, { recursive: true });
  }

  try {
    const checkCmd = process.platform === "win32" ? "where" : "which";
    const whichResult = Bun.spawnSync([checkCmd, "ffmpeg"]);
    if (whichResult.exitCode !== 0) {
      return {
        error: "ffmpeg not found. Install ffmpeg to enable video frame extraction.",
        video,
        installHint: process.platform === "win32" ? "choco install ffmpeg" : "brew install ffmpeg",
      };
    }

    const framePattern = join(output, "frame_%04d.jpg");

    try {
      // Run ffmpeg directly with an argument array — never via `sh -c` — so that
      // interval/count/paths cannot be used for shell command injection.
      Bun.spawnSync([
        "ffmpeg",
        "-i",
        video,
        "-vf",
        `fps=1/${interval}`,
        "-frames:v",
        String(count),
        framePattern,
        "-y",
      ]);

      const frames = readdirSync(output)
        .filter(f => f.startsWith("frame_"))
        .map(f => join(output, f));

      return {
        video,
        frames,
        count: frames.length,
        interval,
        output,
      };
    } catch (cmdError) {
      return {
        error: `ffmpeg extraction failed: ${(cmdError as Error).message}`,
        video,
      };
    }
  } catch {
    return {
      error: "ffmpeg not found. Install ffmpeg to enable video frame extraction.",
      video,
      installHint: "brew install ffmpeg",
    };
  }
};

builtinExecutors.mactop = async (args: Record<string, unknown>) => {
  const seconds = (args.seconds as number) || 5;
  const mode = (args.mode as string) || "efficient";

  try {
    if (process.platform !== "darwin") {
      return {
        error: "mactop is only available on macOS with Apple Silicon.",
        installHint: "This skill requires macOS.",
      };
    }
    const whichResult = Bun.spawnSync(["which", "mactop"]);
    if (whichResult.exitCode !== 0) {
      return {
        error: "mactop not found. Install mactop to enable hardware metrics.",
        installHint: "brew install mactop",
      };
    }

    const cmd = `mactop -t ${seconds} -j`;
    const result = Bun.spawnSync(["sh", "-c", cmd], { timeout: (seconds + 2) * 1000 });
    const output = result.stdout.toString();

    try {
      const data = JSON.parse(output);
      return {
        metrics: data,
        duration: seconds,
        mode,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        output: output.trim(),
        duration: seconds,
        mode,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      error: `mactop execution failed: ${(error as Error).message}`,
      seconds,
      mode,
    };
  }
};

export async function getSkillExecutors(): Promise<Record<string, SkillExecutor>> {
  return { ...builtinExecutors };
}

export async function executeSkill(
  skillName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const normalizedName = skillName.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");

  const executor = builtinExecutors[normalizedName];
  if (executor) {
    return await executor(args);
  }

  const skill = getSkill(skillName);
  if (skill) {
    return {
      error: `Skill "${skillName}" exists but has no automated executor`,
      skill: {
        name: skill.name,
        description: skill.description,
        location: skill.location,
      },
      hint: "Read the skill's SKILL.md for manual instructions",
    };
  }

  throw new Error(`Unknown skill: ${skillName}`);
}

export function registerSkillExecutor(name: string, executor: SkillExecutor): void {
  builtinExecutors[name.toLowerCase().replace(/\s+/g, "_")] = executor;
}
