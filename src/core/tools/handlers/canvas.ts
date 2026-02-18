import { z } from "zod";
import { randomUUID } from "crypto";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

type ToolResult = { success: boolean; error?: string; [key: string]: unknown };

const CANVAS_ACTIONS = [
  "present",
  "hide",
  "navigate",
  "eval",
  "snapshot",
  "a2ui_push",
  "a2ui_reset",
] as const;

const SNAPSHOT_FORMATS = ["png", "jpg", "jpeg"] as const;

export const canvasSchema = z.object({
  action: z.enum(CANVAS_ACTIONS).describe("Canvas action to perform"),
  gatewayUrl: z.string().optional().describe("Gateway URL for node communication"),
  gatewayToken: z.string().optional().describe("Gateway auth token"),
  timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
  node: z.string().optional().describe("Target node ID"),
  target: z.string().optional().describe("URL or path to present"),
  url: z.string().optional().describe("URL or HTML content to display"),
  x: z.number().optional().describe("Window X position"),
  y: z.number().optional().describe("Window Y position"),
  width: z.number().optional().describe("Window width"),
  height: z.number().optional().describe("Window height"),
  javaScript: z.string().optional().describe("JavaScript code to evaluate"),
  outputFormat: z.enum(SNAPSHOT_FORMATS).optional().describe("Image format"),
  maxWidth: z.number().optional().describe("Max width in pixels"),
  quality: z.number().min(0).max(1).optional().describe("JPEG quality (0-1)"),
  delayMs: z.number().optional().describe("Delay before snapshot"),
  jsonl: z.string().optional().describe("JSONL data for A2UI push"),
  jsonlPath: z.string().optional().describe("Path to JSONL file for A2UI push"),
});

export type CanvasParams = z.infer<typeof canvasSchema>;

interface CanvasState {
  isPresented: boolean;
  currentUrl?: string;
  placement?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  a2uiData: string[]; // JSONL lines
  browserPageId?: string; // For browser tool integration
}

const canvasStates = new Map<string, CanvasState>();

function getCanvasState(sessionId: string): CanvasState {
  let state = canvasStates.get(sessionId);
  if (!state) {
    state = { isPresented: false, a2uiData: [] };
    canvasStates.set(sessionId, state);
  }
  return state;
}

function getSnapshotTempPath(format: "png" | "jpeg"): string {
  const dir = join(tmpdir(), "cybara-canvas");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const ext = format === "jpeg" ? "jpg" : "png";
  return join(dir, `snapshot-${randomUUID()}.${ext}`);
}

function writeBase64ToFile(path: string, base64: string): void {
  const buffer = Buffer.from(base64, "base64");
  writeFileSync(path, buffer);
}

let browserHandler: ((args: Record<string, unknown>) => Promise<unknown>) | null = null;

export function setBrowserHandler(
  handler: (args: Record<string, unknown>) => Promise<unknown>
): void {
  browserHandler = handler;
}

async function callBrowser(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!browserHandler) {
    return { success: true, message: `[Simulated] Browser ${action}` };
  }
  return await browserHandler({ action, ...params });
}

export async function handleCanvas(
  args: Record<string, unknown>,
  context?: { sessionId?: string; agentId?: string }
): Promise<ToolResult> {
  const parsed = canvasSchema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      error: `Invalid canvas parameters: ${parsed.error.message}`,
    };
  }

  const params = parsed.data;
  const sessionId = context?.sessionId || "default";
  const state = getCanvasState(sessionId);

  switch (params.action) {
    case "present": {
      const url = params.target || params.url || "about:blank";
      const placement = {
        x: params.x,
        y: params.y,
        width: params.width ?? 800,
        height: params.height ?? 600,
      };

      state.isPresented = true;
      state.currentUrl = url;
      state.placement = placement;

      if (browserHandler) {
        try {
          await callBrowser("open", {
            url,
            headless: false,
            width: placement.width,
            height: placement.height,
          });
          return {
            success: true,
            data: {
              ok: true,
              message: `Canvas presented with ${url}`,
              placement,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to present canvas: ${err}`,
          };
        }
      }

      return {
        success: true,
        data: {
          ok: true,
          message: `Canvas presented${url !== "about:blank" ? ` with ${url}` : ""}`,
          placement,
        },
      };
    }

    case "hide": {
      state.isPresented = false;

      if (browserHandler) {
        try {
          await callBrowser("close");
        } catch {
          // Ignore close errors
        }
      }

      return {
        success: true,
        data: { ok: true, message: "Canvas hidden" },
      };
    }

    case "navigate": {
      const url = params.url;
      if (!url) {
        return {
          success: false,
          error: "URL required for navigate action",
        };
      }

      if (!state.isPresented) {
        state.isPresented = true;
      }
      state.currentUrl = url;

      if (browserHandler) {
        try {
          await callBrowser("navigate", { url });
          return {
            success: true,
            data: { ok: true, message: `Canvas navigated to ${url}` },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to navigate: ${err}`,
          };
        }
      }

      return {
        success: true,
        data: { ok: true, message: `Canvas navigated to ${url}` },
      };
    }

    case "eval": {
      const javaScript = params.javaScript;
      if (!javaScript) {
        return {
          success: false,
          error: "javaScript required for eval action",
        };
      }

      if (!state.isPresented) {
        return {
          success: false,
          error: "Canvas not presented. Call canvas with action='present' first.",
        };
      }

      if (browserHandler) {
        try {
          const result = await callBrowser("evaluate", { script: javaScript });
          return {
            success: true,
            data: {
              ok: true,
              result: typeof result === "object" ? JSON.stringify(result) : String(result),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Eval failed: ${err}`,
          };
        }
      }

      return {
        success: true,
        data: {
          ok: true,
          result: `[Canvas eval: ${javaScript.slice(0, 50)}...]`,
        },
      };
    }

    case "snapshot": {
      if (!state.isPresented) {
        return {
          success: false,
          error: "Canvas not presented. Call canvas with action='present' first.",
        };
      }

      const formatRaw = params.outputFormat || "png";
      const format: "png" | "jpeg" = formatRaw === "jpg" || formatRaw === "jpeg" ? "jpeg" : "png";
      const quality = params.quality;
      const delayMs = params.delayMs;

      if (delayMs && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (browserHandler) {
        try {
          const result = (await callBrowser("screenshot", {
            fullPage: false,
            type: format,
            quality: format === "jpeg" ? Math.round((quality ?? 0.8) * 100) : undefined,
          })) as { base64?: string; path?: string };

          if (result.base64) {
            const filePath = getSnapshotTempPath(format);
            writeBase64ToFile(filePath, result.base64);

            return {
              success: true,
              data: {
                ok: true,
                format,
                path: filePath,
                base64: result.base64,
                mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
              },
            };
          }

          return {
            success: true,
            data: {
              ok: true,
              format,
              path: result.path,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Snapshot failed: ${err}`,
          };
        }
      }

      return {
        success: true,
        data: {
          ok: true,
          format,
          message: `Canvas snapshot captured (${format})`,
          url: state.currentUrl,
        },
      };
    }

    case "a2ui_push": {
      let jsonl = params.jsonl?.trim() || "";

      if (!jsonl && params.jsonlPath?.trim()) {
        try {
          jsonl = await readFile(params.jsonlPath.trim(), "utf8");
        } catch (err) {
          return {
            success: false,
            error: `Failed to read JSONL file: ${err}`,
          };
        }
      }

      if (!jsonl) {
        return {
          success: false,
          error: "jsonl or jsonlPath required for a2ui_push action",
        };
      }

      const lines = jsonl.split("\n").filter((line) => line.trim());
      const parsedLines: unknown[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          parsedLines.push(parsed);
          state.a2uiData.push(line);
        } catch (err) {
          return {
            success: false,
            error: `Invalid JSONL line: ${line.slice(0, 50)}... - ${err}`,
          };
        }
      }

      if (browserHandler && state.isPresented) {
        try {
          await callBrowser("evaluate", {
            script: `
                            window.__cybara_a2ui = window.__cybara_a2ui || [];
                            ${parsedLines.map((p) => `window.__cybara_a2ui.push(${JSON.stringify(p)});`).join("\n")}
                            if (window.__onA2UIUpdate) window.__onA2UIUpdate(window.__cybara_a2ui);
                        `,
          });
        } catch {
          // Ignore eval errors - UI might not have handler
        }
      }

      return {
        success: true,
        data: {
          ok: true,
          message: `Pushed ${lines.length} A2UI lines`,
          lineCount: lines.length,
        },
      };
    }

    case "a2ui_reset": {
      state.a2uiData = [];

      if (browserHandler && state.isPresented) {
        try {
          await callBrowser("evaluate", {
            script: `
                            window.__cybara_a2ui = [];
                            if (window.__onA2UIReset) window.__onA2UIReset();
                        `,
          });
        } catch {
          // Ignore eval errors
        }
      }

      return {
        success: true,
        data: { ok: true, message: "A2UI data reset" },
      };
    }

    default:
      return {
        success: false,
        error: `Unknown canvas action: ${(params as { action: string }).action}`,
      };
  }
}

export function getCanvasStatus(sessionId: string): CanvasState {
  return getCanvasState(sessionId);
}

export function clearCanvasState(sessionId: string): void {
  canvasStates.delete(sessionId);
}

export function getA2UIData(sessionId: string): string[] {
  return getCanvasState(sessionId).a2uiData;
}

export const canvasTool = {
  name: "canvas",
  description:
    "Control canvas for HTML/CSS/JS rendering. Actions: present (show), hide, navigate (load URL), eval (run JS), snapshot (capture image), a2ui_push (push JSONL), a2ui_reset (clear A2UI).",
  schema: canvasSchema,
  handler: handleCanvas,
};
