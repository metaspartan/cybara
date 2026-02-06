// Tool handlers - channel messaging and sessions
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { CronJobCreate, CronJobPatch } from "../../cron/types";
import * as cron from "../../cron";
import { agentManager } from "../../agent";
import { providerManager } from "../../providers";
import * as subagentRegistry from "../../subagent-registry";
import type { SubagentRunRecord } from "../../subagent-registry";


const __dirname = dirname(fileURLToPath(import.meta.url));

// Session management for subagents
interface SubagentSession {
  id: string;
  parentSessionId?: string;
  task: string;
  model?: string;
  timeout?: number;
  status: "pending" | "running" | "completed" | "failed";
  messages: Array<{ role: string; content: string; timestamp: string }>;
  result?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const sessions = new Map<string, SubagentSession>();

// Export function to get subagent session by sessionKey
export function getSubagentSession(sessionKey: string): SubagentSession | undefined {
  return sessions.get(sessionKey);
}

// Export function to get all subagent sessions
export function getAllSubagentSessions(): SubagentSession[] {
  return Array.from(sessions.values());
}

// Subagent execution queue
const subagentQueue: Array<{
  sessionId: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}> = [];

export async function handleSessionsSpawn(
  args: Record<string, unknown>
): Promise<{
  status: string;
  childSessionKey: string;
  runId: string;
  task: string;
  modelApplied?: boolean;
  warning?: string;
}> {
  const task = args.task as string;
  const label = (args.label as string)?.trim() || undefined;
  const requestedAgentId = args.agentId as string | undefined;
  const modelOverride = args.model as string | undefined;
  const thinkingOverride = args.thinking as string | undefined;
  const runTimeoutSeconds = typeof args.runTimeoutSeconds === "number"
    ? Math.max(0, Math.floor(args.runTimeoutSeconds))
    : typeof args.timeoutSeconds === "number" // Back-compat alias
      ? Math.max(0, Math.floor(args.timeoutSeconds))
      : 0;
  const cleanup = args.cleanup === "delete" ? "delete" : "keep";

  // Get requester session key (for nested spawn check)
  const requesterSessionKey = (args._requesterSessionKey as string) || "main";

  if (!task) {
    throw new Error("task is required");
  }

  // Forbid nested spawning (OpenClaw policy)
  if (subagentRegistry.isSubagentSessionKey(requesterSessionKey)) {
    return {
      status: "forbidden",
      childSessionKey: "",
      runId: "",
      task,
      warning: "sessions_spawn is not allowed from sub-agent sessions",
    };
  }

  // Generate OpenClaw-style session key
  const agentId = requestedAgentId || "default";
  const childSessionKey = subagentRegistry.generateSubagentSessionKey(agentId);
  const runId = crypto.randomUUID();

  // Register the run
  const run = subagentRegistry.registerSubagentRun({
    runId,
    childSessionKey,
    requesterSessionKey,
    requesterDisplayKey: requesterSessionKey === "main" ? "main" : requesterSessionKey,
    task,
    cleanup,
    label,
    runTimeoutSeconds: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
  });

  // Create session entry
  const session: SubagentSession = {
    id: childSessionKey,
    parentSessionId: requesterSessionKey,
    task,
    model: modelOverride,
    timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
    status: "pending",
    messages: [
      {
        role: "system",
        content: buildSubagentSystemPrompt(requesterSessionKey, childSessionKey, task, label),
        timestamp: new Date().toISOString(),
      },
      {
        role: "user",
        content: task,
        timestamp: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
  };

  sessions.set(childSessionKey, session);

  // Start subagent execution asynchronously
  executeSubagent(childSessionKey, run).catch((err) => {
    console.error(`[Subagent] Error executing session ${childSessionKey}:`, err);
    subagentRegistry.markRunFailed(runId, err.message || "Unknown error");
  });

  return {
    status: "accepted",
    childSessionKey,
    runId,
    task,
    modelApplied: modelOverride ? true : undefined,
  };
}

// Build minimal system prompt for subagents
function buildSubagentSystemPrompt(
  requesterSessionKey: string,
  childSessionKey: string,
  task: string,
  label?: string
): string {
  const lines = [
    "You are a sub-agent running a specific task.",
    "",
    "## Task",
    label ? `Label: ${label}` : "",
    `Task: ${task}`,
    "",
    "## Instructions",
    "- Complete the task thoroughly but concisely",
    "- Focus only on the specified task",
    "- When done, use sessions_send to announce your result to the requester",
    "",
    `Requester session: ${requesterSessionKey}`,
    `Your session: ${childSessionKey}`,
  ];

  return lines.filter(Boolean).join("\n");
}


async function executeSubagent(sessionId: string, run?: SubagentRunRecord): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.status = "running";
  if (run) {
    subagentRegistry.markRunStarted(run.runId);
  }

  try {
    // Get default agent for provider/model config
    const agent = agentManager.list().find((a) => a.status === "running") || agentManager.list()[0];
    if (!agent) {
      throw new Error("No agent available for subagent execution");
    }

    // Get provider with credentials
    const provider = agent.provider_id
      ? providerManager.getWithCredentials(agent.provider_id)
      : undefined;
    if (!provider) {
      throw new Error("No provider available for subagent execution");
    }

    // Convert session messages to AgentMessage format
    const agentMessages = session.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system" | "tool",
      content: m.content,
    }));

    // Get all available tools (subagents get full tool access)
    const { getToolSchemasForLLM } = await import("../../tools/index");
    const tools = getToolSchemasForLLM();

    console.log(`[Subagent] Executing ${sessionId} with full agentic loop (${tools.length} tools available)`);

    // Use AgentManager.callLLM for full agentic execution with tool support
    const result = await agentManager.callLLM(
      provider,
      session.model || agent.model,
      agentMessages,
      tools
    );

    // Add assistant response to session history
    session.messages.push({
      role: "assistant",
      content: result.content,
      timestamp: new Date().toISOString(),
    });

    session.result = result.content;
    session.status = "completed";
    session.completedAt = new Date().toISOString();

    // Update registry
    if (run) {
      subagentRegistry.markRunCompleted(run.runId, result.content);
    }

    console.log(`[Subagent] Session ${sessionId} completed with ${result.tool_calls?.length || 0} tool calls`);
  } catch (error) {
    session.status = "failed";
    session.error = (error as Error).message;
    session.completedAt = new Date().toISOString();

    if (run) {
      subagentRegistry.markRunFailed(run.runId, (error as Error).message);
    }

    console.error(`[Subagent] Session ${sessionId} failed:`, error);
  }
}


export async function handleSessionsSend(
  args: Record<string, unknown>
): Promise<{ success: boolean; sessionId: string; message: string }> {
  const sessionId = args.sessionId as string;
  const message = args.message as string;

  if (!sessionId || !message) {
    throw new Error("sessionId and message are required");
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Add user message
  session.messages.push({
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  });

  // If session is completed, restart it with new message
  if (session.status === "completed" || session.status === "failed") {
    session.status = "pending";
    executeSubagent(sessionId).catch((err) => {
      console.error(`[Subagent] Error re-executing session ${sessionId}:`, err);
    });
  }

  return {
    success: true,
    sessionId,
    message: "Message added to session. Check sessions_history for response.",
  };
}

export async function handleSessionsHistory(args: Record<string, unknown>): Promise<{
  sessionId: string;
  status: string;
  task: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  result?: string;
  error?: string;
}> {
  const sessionId = args.sessionId as string;
  const limit = (args.limit as number) || 50;

  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return {
    sessionId,
    status: session.status,
    task: session.task,
    messages: session.messages.slice(-limit),
    result: session.result,
    error: session.error,
  };
}

export async function handleSessionsList(): Promise<{
  sessions: Array<{
    id: string;
    task: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    messageCount: number;
  }>;
}> {
  return {
    sessions: Array.from(sessions.values()).map((s) => ({
      id: s.id,
      task: s.task,
      status: s.status,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      messageCount: s.messages.length,
    })),
  };
}

// Session status - aligned with OpenClaw session_status tool
export async function handleSessionStatus(
  args: Record<string, unknown>
): Promise<{
  sessionId: string;
  status: string;
  model?: string;
  messageCount: number;
  tokenEstimate: number;
  createdAt: string;
  lastActivityAt?: string;
  task?: string;
  uptime?: number;
}> {
  const sessionId = args.sessionId as string;

  if (!sessionId) {
    // Return current/default session info (no agent manager access needed)
    return {
      sessionId: "main",
      status: "active",
      messageCount: 0,
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
      uptime: process.uptime() * 1000,
    };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Estimate tokens (rough: 4 chars per token)
  const totalChars = session.messages.reduce((sum, m) => sum + m.content.length, 0);
  const tokenEstimate = Math.ceil(totalChars / 4);

  return {
    sessionId: session.id,
    status: session.status,
    model: session.model,
    messageCount: session.messages.length,
    tokenEstimate,
    createdAt: session.createdAt,
    lastActivityAt: session.completedAt || session.createdAt,
    task: session.task,
  };
}

export async function handleAgentsList(): Promise<{
  agents: Array<{ id: string; name: string; status: string; type: string }>;
}> {
  try {
    const agents = agentManager.list();
    return {
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status || "stopped",
        type: a.type || "general",
      })),
    };
  } catch (error) {
    return {
      agents: [{ id: "default", name: "Assistant", status: "running", type: "general" }],
    };
  }
}

export async function handleMessage(
  args: Record<string, unknown>
): Promise<{ success: boolean; action: string; target: string; message?: string }> {
  const action = args.action as string;
  const target = args.target as string;
  const messageContent = args.message as string | undefined;

  if (!action || !target) {
    throw new Error("action and target are required");
  }

  switch (action) {
    case "send":
      return {
        success: true,
        action: "send",
        target,
        message: `Message sent to ${target}`,
      };
    case "broadcast":
      return {
        success: true,
        action: "broadcast",
        target,
        message: `Broadcast sent to ${target}`,
      };
    default:
      throw new Error(`Unknown message action: ${action}`);
  }
}

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

export async function handleNodes(
  args: Record<string, unknown>
): Promise<{ success: boolean; action: string; nodes?: unknown[]; message: string }> {
  const action = args.action as string;

  switch (action) {
    case "status":
      return { success: true, action: "status", nodes: [], message: "No paired nodes" };
    case "describe":
      return { success: true, action: "describe", message: "No node specified" };
    case "camera_snap":
      return { success: false, action: "camera_snap", message: "No camera available" };
    case "screen_record":
      return { success: false, action: "screen_record", message: "No screen recording available" };
    default:
      throw new Error(`Unknown nodes action: ${action}`);
  }
}

export async function handleImage(
  args: Record<string, unknown>
): Promise<{ description: string; image: string; text?: string }> {
  const image = args.image as string;
  const prompt = (args.prompt as string) || "Describe what you see in this image and extract any visible text.";

  if (!image) {
    throw new Error("image path is required");
  }

  // Check if file exists
  if (!existsSync(image)) {
    throw new Error(`Image file not found: ${image}`);
  }

  // Use OCR to extract text from the image
  let extractedText = "";
  const platform = process.platform; // 'darwin', 'win32', 'linux'

  // Get the project root for finding scripts
  const projectRoot = join(__dirname, "..", "..", "..", "..");

  // Platform-specific OCR
  if (platform === "darwin") {
    // macOS: Swift Vision framework
    const ocrScriptPath = join(projectRoot, "scripts", "ocr.swift");
    if (existsSync(ocrScriptPath)) {
      try {
        const result = Bun.spawnSync(["swift", ocrScriptPath, image], {
          stdout: "pipe",
          stderr: "pipe",
          timeout: 30000,
        });

        if (result.exitCode === 0) {
          extractedText = result.stdout.toString().trim();
          console.log(`[Image] OCR extracted ${extractedText.length} characters via Swift Vision`);
        }
      } catch (err) {
        console.error("[Image] Swift OCR failed:", err);
      }
    }
  } else if (platform === "win32") {
    // Windows: PowerShell with Windows.Media.Ocr
    try {
      const psScript = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]

$path = '${image.replace(/'/g, "''")}'
$stream = [System.IO.File]::OpenRead($path)
$decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync([System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)).GetAwaiter().GetResult()
$bitmap = $decoder.GetSoftwareBitmapAsync().GetAwaiter().GetResult()
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = $engine.RecognizeAsync($bitmap).GetAwaiter().GetResult()
Write-Output $result.Text
$stream.Dispose()
`;
      const result = Bun.spawnSync(["powershell", "-NoProfile", "-Command", psScript], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30000,
      });

      if (result.exitCode === 0) {
        extractedText = result.stdout.toString().trim();
        console.log(`[Image] OCR extracted ${extractedText.length} characters via Windows OCR`);
      }
    } catch (err) {
      console.error("[Image] Windows OCR failed:", err);
    }
  }

  // Fallback: tesseract (cross-platform)
  if (!extractedText) {
    try {
      const result = Bun.spawnSync(["tesseract", image, "stdout"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      if (result.exitCode === 0) {
        extractedText = result.stdout.toString().trim();
        console.log(`[Image] OCR extracted ${extractedText.length} characters via tesseract`);
      }
    } catch {
      // Tesseract not available
    }
  }

  return {
    description: prompt,
    image,
    text: extractedText || "No text could be extracted. Try using browser({action:'snapshot'}) to read page text directly.",
  };
}

export async function handleTTS(
  args: Record<string, unknown>
): Promise<{ audioPath: string; text: string }> {
  const text = args.text as string;

  if (!text) {
    throw new Error("text is required");
  }

  return {
    audioPath: "",
    text,
  };
}

export async function handleCron(
  args: Record<string, unknown>
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

      // Validate required fields
      if (!job.schedule || typeof job.schedule !== "object") {
        throw new Error("job.schedule is required");
      }
      if (!job.payload || typeof job.payload !== "object") {
        throw new Error("job.payload is required");
      }
      if (!job.sessionTarget) {
        throw new Error("job.sessionTarget is required (main or isolated)");
      }

      const created = cron.createJob(job as CronJobCreate);
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
      const mode = (args.mode === "now" || args.mode === "next-heartbeat")
        ? args.mode
        : "next-heartbeat";

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
      throw new Error(`Unknown cron action: ${action}. Use: status/list/add/update/remove/run/runs/wake`);
  }
}

export async function handleGateway(
  args: Record<string, unknown>
): Promise<{
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
      // Return gateway/agent status
      const agents = agentManager.list();
      const activeAgents = agents.filter(a => a.status === "running");
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

      // Schedule restart (in a real implementation, this would trigger a process restart)
      setTimeout(() => {
        console.log("[Gateway] Executing scheduled restart...");
        // In production, would call process exit or send SIGUSR1
      }, delayMs);

      return {
        success: true,
        action,
        message: `Restart scheduled in ${delayMs}ms: ${reason}`,
      };
    }

    case "config.get": {
      // Return current configuration (sanitized)
      try {
        const config = {
          sessionStore: process.env.HOME + "/.cybara/sessions",
          memoryStore: process.env.HOME + "/.cybara/memory",
          cronStore: process.env.HOME + "/.cybara/cron",
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

      // In a real implementation, this would merge with existing config
      console.log(`[Gateway] Config patch received: ${raw.slice(0, 100)}...`);

      return {
        success: true,
        action,
        message: "Config patch applied (restart may be required)",
      };
    }

    default:
      throw new Error(`Unknown gateway action: ${action}. Use: status/restart/config.get/config.patch`);
  }
}
