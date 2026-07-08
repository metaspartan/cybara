import { agentManager } from "../../core/agent";
import {
  getSandboxBrowserStatus,
  startSandboxBrowser,
  stopSandboxBrowser,
} from "../../core/browser/sandbox-browser";
import { tables } from "../../core/database";
import { getSystemMonitorSnapshot } from "../../core/system-monitor";
import { validateBrowserNavigationUrl } from "../../core/tools/handlers/browser";
import * as pwManager from "../../core/browser/pw-manager";
import { getSessionStatusSnapshot, listSessionStatusSnapshots } from "../../core/status";
import { commandExists, isWindows } from "../../core/platform";
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
  "GET /api/browser/status": async () => {
    const getStatus = pwManager.getStatus;
    return await getStatus();
  },
  "GET /api/browser/sandbox/status": () => getSandboxBrowserStatus(),
  "POST /api/browser/sandbox/start": async () => {
    try {
      return { success: true, status: await startSandboxBrowser() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  "POST /api/browser/sandbox/stop": async () => {
    await stopSandboxBrowser();
    return { success: true, status: getSandboxBrowserStatus() };
  },
  "GET /api/browser/tabs": async () => {
    const getAllPages = pwManager.getAllPages;
    return { tabs: await getAllPages() };
  },
  "POST /api/browser/tabs": async () => {
    const createPage = pwManager.createPage;
    const id = await createPage();
    return { success: true, data: { id } };
  },
  "DELETE /api/browser/tabs/:id": async (_body, params) => {
    const closePage = pwManager.closePage;
    const closed = await closePage(params!.id);
    if (!closed) return { error: "Page not found" };
    return { success: true, message: "Page closed" };
  },
  "POST /api/browser/tabs/:id/navigate": async (body, params) => {
    const navigate = pwManager.navigate;
    const { url, waitUntil } = body as {
      url: string;
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
    };
    if (!url) return { error: "URL is required" };
    await validateBrowserNavigationUrl(url);
    const result = await navigate(params!.id, url, { waitUntil });
    return { success: true, data: result };
  },
  "GET /api/browser/tabs/:id/snapshot": async (_body, params) => {
    const getSnapshot = pwManager.getSnapshot;
    const result = await getSnapshot(params!.id);
    return { success: true, data: result };
  },
  "GET /api/browser/tabs/:id/screenshot": async (_body, params) => {
    const screenshot = pwManager.screenshot;
    const screenshotBuffer = await screenshot(params!.id, { fullPage: true });
    return {
      success: true,
      data: {
        screenshot: screenshotBuffer.toString("base64"),
        contentType: "image/png",
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
