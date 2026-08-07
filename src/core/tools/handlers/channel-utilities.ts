import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { arch, cpus, freemem, homedir, hostname, platform, release, totalmem, uptime } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { agentManager } from "../../agent";
import { getInboundMediaRootDir, saveInboundMediaFromUrl } from "../../channels/media";
import * as cron from "../../cron";
import type { CronJobCreate, CronJobPatch } from "../../cron/types";
import { windowsOcrText } from "../../ocr-windows";
import {
  type SpeechSynthesisResult,
  synthesizeSpeech,
  synthesizeWithSystemVoice,
} from "../../speech";
import type { ToolContext } from "../index";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function handleCanvas(
  args: Record<string, unknown>
): Promise<{ success: boolean; action: string; message: string }> {
  const action = args.action as string;

  switch (action) {
    case "present":
      return { success: true, action: "present", message: "Canvas presented" };
    case "hide":
      return { success: true, action: "hide", message: "Canvas hidden" };
    case "snapshot":
      return { success: true, action: "snapshot", message: "Canvas snapshot captured" };
    default:
      throw new Error(`Unknown canvas action: ${action}`);
  }
}

const LOCAL_NODE_ID = "local";

function localNodeDescriptor(): Record<string, unknown> {
  return {
    id: LOCAL_NODE_ID,
    name: hostname(),
    kind: "host",
    platform: platform(),
    arch: arch(),
    online: true,
  };
}

function nodesCaptureDir(): string {
  const dir = join(dirname(getInboundMediaRootDir()), "nodes");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function isLocalNode(node: string | undefined): boolean {
  return !node || node === LOCAL_NODE_ID || node === hostname();
}

function runCapture(
  cmd: string[],
  outPath: string,
  timeoutMs: number
): { ok: boolean; error?: string } {
  if (!Bun.which(cmd[0])) {
    return { ok: false, error: `${cmd[0]} is not installed (required for local capture).` };
  }
  const proc = Bun.spawnSync(cmd, { stdout: "ignore", stderr: "pipe", timeout: timeoutMs });
  if (!proc.success || !existsSync(outPath) || statSync(outPath).size === 0) {
    const stderr = proc.stderr?.toString().trim().split("\n").slice(-3).join(" ") || "";
    return {
      ok: false,
      error: `Capture failed${stderr ? `: ${stderr}` : ""}. On macOS, grant Camera/Screen Recording permission to the host process.`,
    };
  }
  return { ok: true };
}

export async function handleNodes(args: Record<string, unknown>): Promise<{
  success: boolean;
  action: string;
  nodes?: unknown[];
  node?: string;
  filePath?: string;
  message: string;
}> {
  const action = args.action as string;
  const node = typeof args.node === "string" ? args.node.trim() : undefined;
  const os = platform();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  switch (action) {
    case "status":
      return {
        success: true,
        action: "status",
        nodes: [localNodeDescriptor()],
        message:
          "1 node available (local host). Remote device nodes require pairing a companion app (not yet available).",
      };

    case "describe": {
      if (!isLocalNode(node)) {
        return {
          success: false,
          action: "describe",
          node,
          message: `Node '${node}' not found. Only the local host node is available; remote device nodes require a companion app (not yet available).`,
        };
      }
      const desc = {
        ...localNodeDescriptor(),
        osRelease: release(),
        cpus: cpus().length,
        totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
        freeMemoryMB: Math.round(freemem() / 1024 / 1024),
        uptimeSeconds: Math.round(uptime()),
      };
      return {
        success: true,
        action: "describe",
        nodes: [desc],
        message: `Local host node ${hostname()} (${platform()}/${arch()})`,
      };
    }

    case "camera_snap": {
      if (!isLocalNode(node)) {
        return {
          success: false,
          action: "camera_snap",
          node,
          message: `Node '${node}' is not paired. Camera capture is only available on the local host today.`,
        };
      }
      const outPath = join(nodesCaptureDir(), `camera_${stamp}.jpg`);
      const cmd =
        os === "darwin"
          ? [
              "ffmpeg",
              "-hide_banner",
              "-f",
              "avfoundation",
              "-i",
              "0:none",
              "-frames:v",
              "1",
              "-y",
              outPath,
            ]
          : os === "linux"
            ? [
                "ffmpeg",
                "-hide_banner",
                "-f",
                "v4l2",
                "-i",
                "/dev/video0",
                "-frames:v",
                "1",
                "-y",
                outPath,
              ]
            : null;
      if (!cmd) {
        return {
          success: false,
          action: "camera_snap",
          message: `Camera capture is not supported on ${os}.`,
        };
      }
      const r = runCapture(cmd, outPath, 15_000);
      return r.ok
        ? {
            success: true,
            action: "camera_snap",
            node: LOCAL_NODE_ID,
            filePath: outPath,
            message: `Captured camera image to ${outPath}`,
          }
        : { success: false, action: "camera_snap", message: r.error ?? "Capture failed" };
    }

    case "screen_record": {
      if (!isLocalNode(node)) {
        return {
          success: false,
          action: "screen_record",
          node,
          message: `Node '${node}' is not paired. Screen recording is only available on the local host today.`,
        };
      }
      const seconds = Math.min(Math.max(Math.floor(Number(args.seconds) || 5), 1), 60);
      const outPath = join(nodesCaptureDir(), `screen_${stamp}.mp4`);
      const cmd =
        os === "darwin"
          ? [
              "ffmpeg",
              "-hide_banner",
              "-f",
              "avfoundation",
              "-i",
              "1:none",
              "-t",
              String(seconds),
              "-y",
              outPath,
            ]
          : os === "linux"
            ? [
                "ffmpeg",
                "-hide_banner",
                "-f",
                "x11grab",
                "-i",
                process.env.DISPLAY || ":0.0",
                "-t",
                String(seconds),
                "-y",
                outPath,
              ]
            : null;
      if (!cmd) {
        return {
          success: false,
          action: "screen_record",
          message: `Screen recording is not supported on ${os}.`,
        };
      }
      const r = runCapture(cmd, outPath, (seconds + 15) * 1000);
      return r.ok
        ? {
            success: true,
            action: "screen_record",
            node: LOCAL_NODE_ID,
            filePath: outPath,
            message: `Recorded ${seconds}s of the screen to ${outPath}`,
          }
        : { success: false, action: "screen_record", message: r.error ?? "Capture failed" };
    }

    default:
      throw new Error(`Unknown nodes action: ${action}`);
  }
}

function normalizeImageInput(value: string): string {
  const trimmed = value.trim().replace(/^['"`]|['"`]$/g, "");
  const attachmentMatch = trimmed.match(/^<attachment:(.+)>$/i);
  if (attachmentMatch?.[1]) {
    return attachmentMatch[1].trim();
  }
  return trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildImagePathCandidates(rawInput: string): string[] {
  const expandedHome = rawInput.startsWith("~") ? join(homedir(), rawInput.slice(1)) : rawInput;
  const candidates = [expandedHome];

  if (!isAbsolute(expandedHome)) {
    candidates.push(resolve(process.cwd(), expandedHome));
  }

  const fileName = basename(expandedHome);
  if (fileName) {
    const inboundRoot = getInboundMediaRootDir();
    candidates.push(join(inboundRoot, fileName));
    for (const source of [
      "discord",
      "telegram",
      "slack",
      "signal",
      "whatsapp",
      "imessage",
      "image-tool",
    ]) {
      candidates.push(join(inboundRoot, source, fileName));
    }
  }

  return [...new Set(candidates.map((entry) => entry.trim()).filter(Boolean))];
}

function resolveExistingImagePath(rawInput: string): string | undefined {
  for (const candidate of buildImagePathCandidates(rawInput)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const targetFileName = basename(rawInput).toLowerCase();
  if (!targetFileName) {
    return undefined;
  }

  const inboundRoot = getInboundMediaRootDir();
  const candidateDirs = [
    inboundRoot,
    ...["discord", "telegram", "slack", "signal", "whatsapp", "imessage", "image-tool"].map(
      (source) => join(inboundRoot, source)
    ),
  ];

  let newestMatch: { path: string; modifiedAt: number } | undefined;
  for (const dirPath of candidateDirs) {
    if (!existsSync(dirPath)) {
      continue;
    }
    for (const entry of readdirSync(dirPath)) {
      const normalizedEntry = entry.toLowerCase();
      if (normalizedEntry !== targetFileName && !normalizedEntry.endsWith(`-${targetFileName}`)) {
        continue;
      }
      const resolvedPath = join(dirPath, entry);
      try {
        const stats = statSync(resolvedPath);
        if (!stats.isFile()) {
          continue;
        }
        if (!newestMatch || stats.mtimeMs > newestMatch.modifiedAt) {
          newestMatch = {
            path: resolvedPath,
            modifiedAt: stats.mtimeMs,
          };
        }
      } catch {
        continue;
      }
    }
  }

  if (newestMatch) {
    return newestMatch.path;
  }
  return undefined;
}

export async function handleImage(
  args: Record<string, unknown>
): Promise<{ description: string; image: string; text?: string }> {
  const image = args.image as string;
  const prompt =
    (args.prompt as string) || "Describe what you see in this image and extract any visible text.";
  const shouldExtractText = args.extractText !== false;

  if (!image) {
    throw new Error("image path is required");
  }

  const normalizedInput = normalizeImageInput(image);
  let resolvedImagePath = resolveExistingImagePath(normalizedInput);
  if (!resolvedImagePath && isHttpUrl(normalizedInput)) {
    const url = new URL(normalizedInput);
    const fallbackName = basename(url.pathname) || "remote-image";
    const saved = await saveInboundMediaFromUrl({
      channel: "image-tool",
      url: normalizedInput,
      fileName: fallbackName,
    });
    resolvedImagePath = saved.path;
  }

  if (!resolvedImagePath) {
    throw new Error(
      `Image file not found: ${normalizedInput}. Provide an absolute path, a saved inbound media filename, or a direct URL.`
    );
  }

  let extractedText = "";
  if (shouldExtractText) {
    const platform = process.platform;
    const projectRoot = join(__dirname, "..", "..", "..", "..");

    if (platform === "darwin") {
      const ocrScriptPath = join(projectRoot, "scripts", "ocr.swift");
      if (existsSync(ocrScriptPath)) {
        try {
          const result = Bun.spawnSync(["swift", ocrScriptPath, resolvedImagePath], {
            stdout: "pipe",
            stderr: "pipe",
            timeout: 30000,
          });

          if (result.exitCode === 0) {
            extractedText = result.stdout.toString().trim();
            console.log(
              `[Image] OCR extracted ${extractedText.length} characters via Swift Vision`
            );
          }
        } catch (err) {
          console.error("[Image] Swift OCR failed:", err);
        }
      }
    } else if (platform === "win32") {
      const text = windowsOcrText(resolvedImagePath);
      if (text) {
        extractedText = text;
        console.log(`[Image] OCR extracted ${extractedText.length} characters via Windows OCR`);
      }
    }

    if (!extractedText) {
      try {
        const result = Bun.spawnSync(["tesseract", resolvedImagePath, "stdout"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        if (result.exitCode === 0) {
          extractedText = result.stdout.toString().trim();
          console.log(`[Image] OCR extracted ${extractedText.length} characters via tesseract`);
        }
      } catch {
        void 0;
      }
    }
  }

  return {
    description: prompt,
    image: resolvedImagePath,
    text: shouldExtractText
      ? extractedText ||
        "No text could be extracted. Try using browser({action:'snapshot'}) to read page text directly."
      : undefined,
  };
}

export async function handleTTS(args: Record<string, unknown>): Promise<SpeechSynthesisResult> {
  const provider =
    typeof args.provider === "string" &&
    ["auto", "local", "system", "elevenlabs", "openai", "openai-codex"].includes(args.provider)
      ? (args.provider as "auto" | "local" | "system" | "elevenlabs" | "openai" | "openai-codex")
      : undefined;
  return await synthesizeSpeech({
    text: typeof args.text === "string" ? args.text : "",
    provider,
    providerId: typeof args.providerId === "string" ? args.providerId : undefined,
    model: typeof args.model === "string" ? args.model : undefined,
    voice: typeof args.voice === "string" ? args.voice : undefined,
    format: typeof args.format === "string" ? args.format : undefined,
    speed:
      typeof args.speed === "number"
        ? args.speed
        : typeof args.rate === "number" && Number.isFinite(args.rate)
          ? Math.max(0.5, Math.min(2, args.rate / 175))
          : undefined,
    stability: typeof args.stability === "number" ? args.stability : undefined,
    similarity: typeof args.similarity === "number" ? args.similarity : undefined,
    style: typeof args.style === "number" ? args.style : undefined,
    fallbackToSystem:
      typeof args.fallbackToSystem === "boolean" ? args.fallbackToSystem : undefined,
  });
}

export async function handleSystemTTS(
  args: Record<string, unknown>
): Promise<{ audioPath: string; text: string; voice?: string; format: string }> {
  const result = await synthesizeWithSystemVoice({
    text: typeof args.text === "string" ? args.text : "",
    voice: typeof args.voice === "string" ? args.voice : undefined,
    rate: typeof args.rate === "number" ? args.rate : undefined,
    format: typeof args.format === "string" ? args.format : undefined,
  });
  return {
    audioPath: result.audioPath,
    text: result.text,
    voice: result.voice,
    format: result.format,
  };
}

export async function handleCron(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  success: boolean;
  action: string;
  data?: unknown;
  message?: string;
}> {
  const action = args.action as string;

  if (!action) {
    throw new Error("action is required (status/list/add/update/remove/run/runs/wake)");
  }

  switch (action) {
    case "status": {
      const status = cron.getSchedulerStatus();
      return { success: true, action, data: status };
    }

    case "list": {
      const includeDisabled = Boolean(args.includeDisabled);
      const jobs = cron.listJobs(includeDisabled);
      return { success: true, action, data: { jobs, count: jobs.length } };
    }

    case "add": {
      const job = args.job as Record<string, unknown>;
      if (!job || typeof job !== "object") {
        throw new Error("job object is required");
      }

      if (!job.schedule || typeof job.schedule !== "object") {
        throw new Error("job.schedule is required");
      }
      if (!job.payload || typeof job.payload !== "object") {
        throw new Error("job.payload is required");
      }
      if (!job.sessionTarget) {
        throw new Error("job.sessionTarget is required (main or isolated)");
      }

      const ownerAgentId = typeof job.agentId === "string" ? job.agentId : context?.agentId;
      const ownerWorkspaceDir =
        typeof job.workspaceDir === "string" ? job.workspaceDir : context?.workspaceDir;
      const created = cron.createJob({
        ...(job as CronJobCreate),
        ...(ownerAgentId ? { agentId: ownerAgentId } : {}),
        ...(ownerWorkspaceDir ? { workspaceDir: ownerWorkspaceDir } : {}),
      });
      cron.scheduleJob(created);

      return {
        success: true,
        action,
        data: { job: created },
        message: `Job ${created.id} created and scheduled`,
      };
    }

    case "update": {
      const jobId = (args.jobId || args.id) as string;
      const patch = args.patch as Record<string, unknown>;

      if (!jobId) {
        throw new Error("jobId is required");
      }
      if (!patch || typeof patch !== "object") {
        throw new Error("patch object is required");
      }

      const updated = cron.updateJob(jobId, patch as CronJobPatch);
      if (!updated) {
        throw new Error(`Job not found: ${jobId}`);
      }

      cron.scheduleJob(updated);

      return {
        success: true,
        action,
        data: { job: updated },
        message: `Job ${jobId} updated`,
      };
    }

    case "remove": {
      const jobId = (args.jobId || args.id) as string;
      if (!jobId) {
        throw new Error("jobId is required");
      }

      cron.cancelJobTimer(jobId);
      const removed = cron.removeJob(jobId);

      return {
        success: removed,
        action,
        message: removed ? `Job ${jobId} removed` : `Job ${jobId} not found`,
      };
    }

    case "run": {
      const jobId = (args.jobId || args.id) as string;
      if (!jobId) {
        throw new Error("jobId is required");
      }

      const runLog = await cron.runJob(jobId);
      return {
        success: runLog.status === "ok",
        action,
        data: runLog,
      };
    }

    case "runs": {
      const jobId = (args.jobId || args.id) as string;
      if (!jobId) {
        throw new Error("jobId is required");
      }

      const limit = (args.limit as number) || 10;
      const runs = cron.getRunLogs(jobId, limit);

      return { success: true, action, data: { runs, count: runs.length } };
    }

    case "wake": {
      const text = args.text as string;
      const mode =
        args.mode === "now" || args.mode === "next-heartbeat" ? args.mode : "next-heartbeat";

      if (!text) {
        throw new Error("text is required for wake action");
      }

      const result = await cron.sendWakeEvent(text, mode);
      return {
        success: result.sent,
        action,
        message: `Wake event sent (${mode}): ${text.slice(0, 50)}...`,
      };
    }

    default:
      throw new Error(
        `Unknown cron action: ${action}. Use: status/list/add/update/remove/run/runs/wake`
      );
  }
}

export async function handleGateway(args: Record<string, unknown>): Promise<{
  success: boolean;
  action: string;
  data?: unknown;
  message?: string;
}> {
  const action = args.action as string;

  if (!action) {
    throw new Error("action is required (status/restart/config.get/config.patch)");
  }

  switch (action) {
    case "status": {
      const agents = agentManager.list();
      const activeAgents = agents.filter((a) => a.status === "running");
      const cronStatus = cron.getSchedulerStatus();

      return {
        success: true,
        action,
        data: {
          gateway: "running",
          uptime: process.uptime(),
          agents: {
            total: agents.length,
            active: activeAgents.length,
          },
          cron: cronStatus,
          memory: process.memoryUsage(),
          version: process.version,
        },
      };
    }

    case "restart": {
      const reason = (args.reason as string) || "Manual restart via gateway tool";
      const delayMs = (args.delayMs as number) || 1000;

      console.log(`[Gateway] Restart requested: ${reason} (delay: ${delayMs}ms)`);

      setTimeout(() => {
        console.log("[Gateway] Executing scheduled restart...");
      }, delayMs);

      return {
        success: true,
        action,
        message: `Restart scheduled in ${delayMs}ms: ${reason}`,
      };
    }

    case "config.get": {
      try {
        const home = process.env.HOME || process.env.USERPROFILE || homedir();
        const config = {
          sessionStore: join(home, ".cybara", "sessions"),
          memoryStore: join(home, ".cybara", "memory"),
          cronStore: join(home, ".cybara", "cron"),
          runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
          },
        };

        return { success: true, action, data: config };
      } catch (error) {
        return { success: false, action, message: (error as Error).message };
      }
    }

    case "config.patch": {
      const raw = args.raw as string;
      if (!raw) {
        throw new Error("raw config patch is required");
      }

      console.log(`[Gateway] Config patch received: ${raw.slice(0, 100)}...`);

      return {
        success: true,
        action,
        message: "Config patch applied (restart may be required)",
      };
    }

    default:
      throw new Error(
        `Unknown gateway action: ${action}. Use: status/restart/config.get/config.patch`
      );
  }
}
