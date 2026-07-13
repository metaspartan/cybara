import { agentManager } from "../../core/agent";
import * as pwManager from "../../core/browser/pw-manager";
import {
  getSandboxBrowserStatus,
  startSandboxBrowser,
  stopSandboxBrowser,
} from "../../core/browser/sandbox-browser";
import { tables } from "../../core/database";
import { commandExists, isWindows } from "../../core/platform";
import {
  activeComputerUseTrajectoryId,
  clearComputerUsePreview,
  getComputerUsePreview,
  replayComputerUseTrajectory,
  stopComputerUseTrajectoryCapture,
} from "../../core/computer-use";
import {
  deleteComputerUseTrajectory,
  exportComputerUseTrajectories,
  getComputerUseTrajectory,
  listComputerUseTrajectories,
} from "../../core/computer-use-trajectories";
import { config } from "../../core/config";
import { getSessionStatusSnapshot, listSessionStatusSnapshots } from "../../core/status";
import { getSystemMonitorSnapshot } from "../../core/system-monitor";
import {
  getBrowserPageIdForSession,
  getOrCreateBrowserPageForSession,
  releaseBrowserPage,
  validateBrowserNavigationUrl,
} from "../../core/tools/handlers/browser";
import { isSessionStatusActive, type RouteHandler } from "./_shared";

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteCmd(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function browserSessionId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function browserViewportDimension(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(320, Math.round(parsed))) : fallback;
}

function browserScreenshotQuality(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.min(90, Math.max(40, Math.round(parsed))) : 72;
}

function buildRestartCommand(argv: string[], cwd: string): string[] {
  if (isWindows()) {
    const powerShell = commandExists("pwsh")
      ? "pwsh"
      : commandExists("powershell")
        ? "powershell"
        : null;
    if (powerShell) {
      const args = argv.slice(1).map(quotePowerShell).join(",");
      const command = [
        "Start-Sleep -Seconds 2",
        `Start-Process -FilePath ${quotePowerShell(argv[0])} -ArgumentList @(${args}) -WorkingDirectory ${quotePowerShell(cwd)}`,
      ].join("; ");
      return [
        powerShell,
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ];
    }
    const command = `ping -n 3 127.0.0.1 > nul & start "" /d ${quoteCmd(cwd)} ${argv.map(quoteCmd).join(" ")}`;
    return ["cmd.exe", "/d", "/s", "/c", command];
  }
  const quoted = argv.map(quotePosix).join(" ");
  return ["sh", "-c", `nohup sh -c 'sleep 2; exec ${quoted.replaceAll("'", "'\\''")}' &`];
}

export const runtimeRoutes: Record<string, RouteHandler> = {
  "GET /api/computer-use/preview": (_body, params) => {
    const sessionId = browserSessionId(params?.sessionId);
    if (!sessionId) return { success: false, error: "Session ID is required" };
    const screenshotRevision = Number(params?.screenshotRevision);
    return {
      success: true,
      data: getComputerUsePreview(
        sessionId,
        Number.isFinite(screenshotRevision) ? screenshotRevision : undefined
      ),
    };
  },
  "DELETE /api/computer-use/preview": (_body, params) => {
    const sessionId = browserSessionId(params?.sessionId);
    if (!sessionId) return { success: false, error: "Session ID is required" };
    clearComputerUsePreview(sessionId);
    return { success: true };
  },
  "GET /api/computer-use/trajectories": () => ({
    trajectories: listComputerUseTrajectories(activeComputerUseTrajectoryId()),
    activeId: activeComputerUseTrajectoryId() ?? null,
    settings: config.getComputerUseSettings(),
  }),
  "GET /api/computer-use/trajectories/export": (_body, params) => {
    const ids = (params?.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 500);
    return exportComputerUseTrajectories(ids, {
      includeMedia: params?.includeMedia === "1" || params?.includeMedia === "true",
      redact: params?.redact !== "0" && params?.redact !== "false",
    });
  },
  "POST /api/computer-use/trajectories/config": async (body) => {
    const data = (body || {}) as {
      trajectoryCaptureEnabled?: unknown;
      trajectoryVideoEnabled?: unknown;
    };
    const current = config.getComputerUseSettings();
    const next = config.setComputerUseSettings({
      ...current,
      trajectoryCaptureEnabled:
        typeof data.trajectoryCaptureEnabled === "boolean"
          ? data.trajectoryCaptureEnabled
          : current.trajectoryCaptureEnabled,
      trajectoryVideoEnabled:
        typeof data.trajectoryVideoEnabled === "boolean"
          ? data.trajectoryVideoEnabled
          : current.trajectoryVideoEnabled,
    });
    if (!next.trajectoryCaptureEnabled) await stopComputerUseTrajectoryCapture();
    return { success: true, settings: next };
  },
  "GET /api/computer-use/trajectories/:id": (_body, params) => {
    const trajectory = getComputerUseTrajectory(params!.id, activeComputerUseTrajectoryId());
    return trajectory ? { success: true, trajectory } : { success: false, error: "Not found" };
  },
  "POST /api/computer-use/trajectories/:id/replay": async (body, params) => {
    const data = (body || {}) as { delayMs?: unknown; stopOnError?: unknown };
    const delayMs = Number(data.delayMs);
    const result = await replayComputerUseTrajectory(params!.id, {
      delayMs: Number.isFinite(delayMs) ? delayMs : undefined,
      stopOnError: data.stopOnError !== false,
    });
    return { success: true, ...result };
  },
  "DELETE /api/computer-use/trajectories/:id": async (_body, params) => {
    if (params!.id === activeComputerUseTrajectoryId()) {
      await stopComputerUseTrajectoryCapture();
    }
    return { success: deleteComputerUseTrajectory(params!.id) };
  },
  "GET /api/browser/status": async () => {
    const getStatus = pwManager.getStatus;
    return await getStatus();
  },
  "GET /api/browser/sandbox/status": () => getSandboxBrowserStatus(),
  "POST /api/browser/sandbox/start": async () => {
    try {
      return { success: true, status: await startSandboxBrowser() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  "POST /api/browser/sandbox/stop": async () => {
    await stopSandboxBrowser();
    return { success: true, status: getSandboxBrowserStatus() };
  },
  "GET /api/browser/tabs": async (_body, params) => {
    const sessionId = browserSessionId(params?.sessionId);
    if (sessionId) {
      const pageId = getBrowserPageIdForSession(sessionId);
      if (!pageId) return { tabs: [] };
      const tabs = await pwManager.getAllPages();
      return { tabs: tabs.filter((tab) => tab.id === pageId) };
    }
    const getAllPages = pwManager.getAllPages;
    return { tabs: await getAllPages() };
  },
  "POST /api/browser/tabs": async (body) => {
    const sessionId = browserSessionId((body as { sessionId?: unknown })?.sessionId);
    const id = sessionId
      ? await getOrCreateBrowserPageForSession(sessionId)
      : await pwManager.createPage();
    return { success: true, data: { id } };
  },
  "DELETE /api/browser/tabs/:id": async (_body, params) => {
    const closePage = pwManager.closePage;
    const closed = await closePage(params!.id);
    if (!closed) return { error: "Page not found" };
    releaseBrowserPage(params!.id);
    return { success: true, message: "Page closed" };
  },
  "POST /api/browser/tabs/:id/navigate": async (body, params) => {
    const navigate = pwManager.navigate;
    const { url, waitUntil } = body as {
      url: string;
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
    };
    if (!url) return { error: "URL is required" };
    const navigationUrl = await validateBrowserNavigationUrl(url);
    const result = await navigate(params!.id, navigationUrl, { waitUntil });
    return { success: true, data: result };
  },
  "POST /api/browser/tabs/:id/back": async (_body, params) => ({
    success: true,
    data: await pwManager.goBack(params!.id),
  }),
  "POST /api/browser/tabs/:id/forward": async (_body, params) => ({
    success: true,
    data: await pwManager.goForward(params!.id),
  }),
  "POST /api/browser/tabs/:id/reload": async (_body, params) => ({
    success: true,
    data: await pwManager.reload(params!.id),
  }),
  "GET /api/browser/tabs/:id/snapshot": async (_body, params) => {
    const getSnapshot = pwManager.getSnapshot;
    const result = await getSnapshot(params!.id);
    return { success: true, data: result };
  },
  "GET /api/browser/tabs/:id/state": async (_body, params) => ({
    success: true,
    data: {
      viewport: pwManager.getViewportSize(params!.id),
      cursor: pwManager.getPointerState(params!.id),
      page: await pwManager.getPageSummary(params!.id),
    },
  }),
  "GET /api/browser/tabs/:id/screenshot": async (_body, params) => {
    const screenshot = pwManager.screenshot;
    const width = browserViewportDimension(params?.viewportWidth, 1280, 2560);
    const height = browserViewportDimension(params?.viewportHeight, 800, 1600);
    const format = params?.format === "jpeg" ? "jpeg" : "png";
    await pwManager.resize(params!.id, width, height);
    const screenshotBuffer = await screenshot(params!.id, {
      fullPage: params?.fullPage !== "false",
      type: format,
      ...(format === "jpeg" ? { quality: browserScreenshotQuality(params?.quality) } : {}),
    });
    const page = await pwManager.getPageSummary(params!.id);
    return {
      success: true,
      data: {
        screenshot: screenshotBuffer.toString("base64"),
        contentType: format === "jpeg" ? "image/jpeg" : "image/png",
        viewport: pwManager.getViewportSize(params!.id),
        cursor: pwManager.getPointerState(params!.id),
        page,
      },
    };
  },
  "POST /api/browser/tabs/:id/click": async (body, params) => {
    const click = pwManager.click;
    const { selector, button, doubleClick } = body as {
      selector: string;
      button?: "left" | "right" | "middle";
      doubleClick?: boolean;
    };
    if (!selector) return { error: "Selector is required" };
    await click(params!.id, selector, { button, doubleClick });
    return { success: true, message: "Clicked element" };
  },
  "POST /api/browser/tabs/:id/pointer/click": async (body, params) => {
    const { x, y } = body as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x + y)) {
      return { error: "Finite pointer coordinates are required" };
    }
    await pwManager.clickAt(params!.id, x, y);
    return { success: true, message: "Clicked page" };
  },
  "POST /api/browser/tabs/:id/scroll": async (body, params) => {
    const { deltaX, deltaY } = body as { deltaX?: unknown; deltaY?: unknown };
    if (typeof deltaX !== "number" || typeof deltaY !== "number") {
      return { error: "Scroll deltas are required" };
    }
    const boundedX = Math.min(4000, Math.max(-4000, deltaX));
    const boundedY = Math.min(4000, Math.max(-4000, deltaY));
    await pwManager.scrollPage(params!.id, boundedX, boundedY);
    return { success: true, message: "Scrolled page" };
  },
  "POST /api/browser/tabs/:id/keyboard": async (body, params) => {
    const { key } = body as { key?: unknown };
    if (typeof key !== "string" || key.length === 0 || key.length > 32) {
      return { error: "A valid key is required" };
    }
    await pwManager.sendKey(params!.id, key);
    return { success: true, message: "Sent key" };
  },
  "POST /api/browser/tabs/:id/type": async (body, params) => {
    const type = pwManager.type;
    const { selector, text, submit, clear } = body as {
      selector: string;
      text: string;
      submit?: boolean;
      clear?: boolean;
    };
    if (!selector || typeof text !== "string") return { error: "Selector and text are required" };
    await type(params!.id, selector, text, { submit, clear });
    return { success: true, message: "Typed text" };
  },
  "POST /api/browser/close": async () => {
    const closeAll = pwManager.closeAll;
    await closeAll();
    return { success: true, message: "Browser closed" };
  },

  "GET /api/status/sessions": (_body, params) => {
    const sessionId =
      typeof params?.sessionId === "string" && params.sessionId.trim().length > 0
        ? params.sessionId.trim()
        : null;
    const activeSnapshots = listSessionStatusSnapshots();

    if (sessionId) {
      const snapshot = getSessionStatusSnapshot(sessionId);
      return {
        sessionId,
        active: snapshot ? isSessionStatusActive(snapshot.status) : false,
        session: snapshot,
        activeSessionIds: activeSnapshots.map((entry) => entry.sessionId),
      };
    }

    return {
      activeSessions: activeSnapshots,
      activeSessionIds: activeSnapshots.map((entry) => entry.sessionId),
      count: activeSnapshots.length,
    };
  },

  "GET /api/system/status": () => {
    const metrics = tables.metrics;
    const lastActivityTime = metrics.getLatestValue("system_status", "last_activity") ?? 0;
    const now = Date.now();
    const isThinking = lastActivityTime > 0 && now - lastActivityTime < 30000;
    const agentCount = agentManager.list().length;
    return {
      status: isThinking ? "thinking" : "idle",
      lastActivity: lastActivityTime,
      agentCount,
      timestamp: now,
      resources: getSystemMonitorSnapshot(),
    };
  },

  "GET /api/system/monitor": () => getSystemMonitorSnapshot(),

  "POST /api/system/restart": () => {
    const supervised = process.env.CYBARA_NATIVE_APP === "1";
    setTimeout(() => {
      if (!supervised) {
        const argv = [process.execPath, ...process.argv.slice(1)];
        const child = Bun.spawn(buildRestartCommand(argv, process.cwd()), {
          cwd: process.cwd(),
          env: process.env,
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
        });
        child.unref();
      }
      setTimeout(() => process.exit(0), 700);
    }, 400);
    return { success: true, supervised, message: "Gateway restarting" };
  },
};
