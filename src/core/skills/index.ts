import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, dirname, basename, extname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
// ============================================================================
// OpenClaw-compatible Skills System (new modular architecture)
// ============================================================================

// Types
export type {
  SkillInstallSpec,
  SkillMetadata,
  SkillInvocationPolicy,
  SkillCommandDispatch,
  SkillCommandSpec,
  SkillFrontmatter,
  Skill as OpenClawSkill,
  SkillEntry,
  SkillEligibilityContext,
  SkillStatus,
  SkillSnapshot,
  SkillsConfig,
  SkillsInstallPreferences,
} from "./types";

// Loader
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

// Gating
export {
  hasBinary,
  hasEnvVar,
  hasConfigPath,
  createEligibilityContext,
  checkSkillEligibility,
  filterEligibleSkills,
  getSkillsStatusReport,
} from "./gating";

// Registry (multi-registry: ClawdHub, skills.sh, CybaraHub)
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

// ============================================================================
// Legacy Skill System (for backwards compatibility)
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
// Calculate workspace path - handle both dev and compiled binary modes
// In compiled binaries, __dirname points to virtual filesystem /$bunfs/root
const getWorkspacePath = (): string => {
  if (__dirname.startsWith("/$bunfs") || __dirname.includes("$bunfs")) {
    // Compiled binary - use executable path
    const execDir = dirname(process.execPath);
    return resolve(execDir, "..");
  }
  // Development mode - __dirname is src/core/skills, go up 3 levels
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

// Default skills are now loaded from the local skills/ directory
// Users can add their own skills by creating a folder in skills/ with a SKILL.md file
const defaultSkills: SkillDefinition[] = [
  // Skills are discovered from ./skills/{skill-name}/SKILL.md
  // Add your custom skills there
];

// Cache for loaded skills
let skillsCache: Skill[] | null = null;

// Load a single skill from SKILL.md
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

    // Parse YAML frontmatter (between --- markers)
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // Extract name from frontmatter
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        name = nameMatch[1].trim();
      }

      // Extract description from frontmatter (handle multiline with |)
      const descMatch = frontmatter.match(/^description:\s*\|?\s*\n?([\s\S]*?)(?=\n[a-z]+:|$)/m);
      if (descMatch) {
        description = descMatch[1].trim().split("\n").map(l => l.trim()).join(" ").slice(0, 300);
      } else {
        // Single-line description
        const singleDescMatch = frontmatter.match(/^description:\s*(.+)$/m);
        if (singleDescMatch) {
          description = singleDescMatch[1].trim().slice(0, 300);
        }
      }
    }

    // Fallback: extract from first heading if no frontmatter description
    if (!description) {
      const headingMatch = content.match(/#\s+([^\n]+)\n([^#]+)/);
      if (headingMatch) {
        description = headingMatch[2].trim().slice(0, 200);
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

// Get all available skills
export function getSkills(): Skill[] {
  if (skillsCache) {
    return skillsCache;
  }

  const skills: Skill[] = [];

  // Load default skills
  for (const def of defaultSkills) {
    const skill = loadSkillFromFile(def.location);
    if (skill) {
      skill.description = def.description;
      skill.category = def.category;
      skills.push(skill);
    }
  }

  // Scan for custom skills in the platform's skills directory (root level)
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

  // Scan for installed skills from registry (~/.cybara/skills)
  const localSkillsDir = join(homedir(), ".cybara", "skills");
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

  skillsCache = skills;
  return skills;
}

// Get skill by name
export function getSkill(name: string): Skill | undefined {
  const skills = getSkills();
  const normalizedName = name.toLowerCase().replace(/\s+/g, "-");
  return skills.find(
    (s) =>
      s.name.toLowerCase().replace(/\s+/g, "-") === normalizedName ||
      basename(s.location, extname(s.location)) === normalizedName
  );
}

// Get skills by category
export function getSkillsByCategory(category: string): Skill[] {
  return getSkills().filter((s) => s.category === category);
}

// Get available skill categories
export function getSkillCategories(): string[] {
  const categories = new Set(getSkills().map((s) => s.category));
  return Array.from(categories);
}

// Clear skills cache (useful when skills are added/removed)
export function clearSkillsCache(): void {
  skillsCache = null;
}

// Skill execution interface
export interface SkillExecutor {
  (args: Record<string, unknown>): Promise<unknown>;
}

// Import skill handlers
import { handleCalc, handleConvert } from "./calc";
import { handlePdf } from "./pdf";
import { handleOcr, handleImageDescribe } from "./ocr";

// Built-in skill executors
const builtinExecutors: Record<string, SkillExecutor> = {
  // Calculator skills
  calc: handleCalc,
  calculate: handleCalc,
  convert: handleConvert,
  unit_convert: handleConvert,

  // PDF skills
  pdf: handlePdf,
  pdf_extract: handlePdf,

  // OCR skills
  ocr: handleOcr,
  image_to_text: handleOcr,
  image_describe: handleImageDescribe,
};

// Weather skill executor
builtinExecutors.weather = async (args: Record<string, unknown>) => {
  const location = (args.location as string) || "";
  const format = (args.format as string) || "short";

  try {
    // Use wttr.in for weather data
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

// Summarization skill executor
builtinExecutors.summarization = async (args: Record<string, unknown>) => {
  const text = args.text as string;
  const maxLength = (args.maxLength as number) || 200;
  const style = (args.style as string) || "brief";

  if (!text) {
    throw new Error("Text is required for summarization");
  }

  // Simple extractive summarization
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  if (style === "bullet") {
    // Return key sentences as bullet points
    const keyPoints = sentences.slice(0, Math.min(5, sentences.length));
    return {
      summary: keyPoints.map(s => `• ${s.trim()}`).join("\n"),
      style: "bullet",
      originalLength: text.length,
    };
  }

  // Brief or detailed style
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

// Video frames skill executor (requires ffmpeg)
builtinExecutors.video_frames = async (args: Record<string, unknown>) => {
  const video = args.video as string;
  const interval = (args.interval as number) || 10;
  const count = (args.count as number) || 5;
  const output = (args.output as string) || "/tmp/frames";

  if (!video) {
    throw new Error("Video path is required");
  }

  if (!existsSync(video)) {
    throw new Error(`Video file not found: ${video}`);
  }

  // Create output directory
  if (!existsSync(output)) {
    mkdirSync(output, { recursive: true });
  }

  // Check if ffmpeg is available (use 'where' on Windows, 'which' elsewhere)
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

    // Extract frames using ffmpeg
    const framePattern = join(output, "frame_%04d.jpg");
    const cmd = `ffmpeg -i "${video}" -vf "fps=1/${interval}" -frames:v ${count} "${framePattern}" -y 2>&1`;

    try {
      Bun.spawnSync(["sh", "-c", cmd]);

      // List extracted frames
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

// Mactop skill executor - real-time hardware metrics for Apple Silicon Macs
builtinExecutors.mactop = async (args: Record<string, unknown>) => {
  const seconds = (args.seconds as number) || 5;
  const mode = (args.mode as string) || "efficient";

  try {
    // Check if mactop is available (macOS only)
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

    // Run mactop for specified duration and capture output
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
      // Fallback to text output if JSON parsing fails
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

// Get skill executors
export async function getSkillExecutors(): Promise<Record<string, SkillExecutor>> {
  return { ...builtinExecutors };
}

// Execute a skill by name
export async function executeSkill(
  skillName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const normalizedName = skillName.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");

  const executor = builtinExecutors[normalizedName];
  if (executor) {
    return await executor(args);
  }

  // Check if skill exists but has no executor
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

// Register a custom skill executor
export function registerSkillExecutor(name: string, executor: SkillExecutor): void {
  builtinExecutors[name.toLowerCase().replace(/\s+/g, "_")] = executor;
}
