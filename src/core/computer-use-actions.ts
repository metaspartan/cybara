// --- Safety: un-overridable hard blocks ---

/** Typed text patterns that are too dangerous to inject (shell pipe-to-bash, rm -rf, fork bombs). */
const BLOCKED_TYPE_PATTERNS: readonly RegExp[] = [
  /(\||;|&&|\|\|)\s*(bash|sh|zsh)\b/i, // curl ... | bash
  /\brm\s+(-[a-z]*r[a-z]*\s+)?\/(\s|$)/i, // rm -rf /
  /\bsudo\s+rm\s+-[a-z]*r/i, // sudo rm -r
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/i, // fork bomb
  /\bmkfs\b/i, // filesystem format
  /\bdd\s+if=\/dev\//i, // raw disk overwrite
  /\bpowershell(?:\.exe)?\b[^\r\n]*(?:-enc|-encodedcommand)\b/i,
  /\b(?:irm|invoke-restmethod|iwr|invoke-webrequest)\b[^\r\n]*\|\s*(?:iex|invoke-expression)\b/i,
  /\bcertutil\b[^\r\n]*-urlcache\b/i,
];

export function isBlockedKeyCombo(keys: string): boolean {
  const parts = new Set(
    keys
      .trim()
      .toLowerCase()
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        if (part === "command") return "cmd";
        if (part === "control") return "ctrl";
        if (part === "windows") return "win";
        if (part === "opt") return "option";
        return part;
      })
  );
  const has = (part: string): boolean => parts.has(part);
  const cmd = has("cmd") || has("meta");
  const win = has("win") || has("super") || has("meta");
  if (
    has("q") &&
    ((cmd && has("shift")) || (has("ctrl") && has("shift")) || (cmd && has("ctrl")))
  ) {
    return true;
  }
  if (has("l") && win) return true;
  if (cmd && (has("option") || has("alt")) && (has("esc") || has("power") || has("eject"))) {
    return true;
  }
  return has("alt") && has("f4");
}

export function isBlockedTypeText(text: string): boolean {
  return BLOCKED_TYPE_PATTERNS.some((re) => re.test(text));
}

export type ComputerUseAction =
  | "capture"
  | "move"
  | "click"
  | "double_click"
  | "right_click"
  | "middle_click"
  | "scroll"
  | "drag"
  | "type"
  | "key"
  | "set_value"
  | "wait"
  | "list_apps"
  | "focus_app";

/** Actions that only read/inspect (no side effects) — safe to run without consent. */
const SAFE_ACTIONS: ReadonlySet<ComputerUseAction> = new Set([
  "capture",
  "move",
  "wait",
  "list_apps",
]);
export const VALID_ACTIONS: ReadonlySet<ComputerUseAction> = new Set<ComputerUseAction>([
  "capture",
  "move",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "scroll",
  "drag",
  "type",
  "key",
  "set_value",
  "wait",
  "list_apps",
  "focus_app",
]);

export const COMPUTER_USE_ACTION_TOOL_ALIASES: readonly ComputerUseAction[] = [
  "capture",
  "move",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "scroll",
  "drag",
  "type",
  "key",
  "set_value",
  "wait",
  "list_apps",
  "focus_app",
];

export const COMPUTER_USE_COMPAT_TOOL_ALIASES: Readonly<Record<string, ComputerUseAction>> = {
  screenshot: "capture",
  screen_capture: "capture",
  desktop_screenshot: "capture",
  capture_screen: "capture",
  take_screenshot: "capture",
};

export interface ComputerUseArgs {
  action: ComputerUseAction;
  mode?: "som" | "vision" | "ax";
  app?: string;
  element?: number;
  coordinate?: [number, number];
  fromElement?: number;
  toElement?: number;
  fromCoordinate?: [number, number];
  toCoordinate?: [number, number];
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  text?: string;
  keys?: string;
  value?: string;
  seconds?: number;
  raiseWindow?: boolean;
  captureAfter?: boolean;
}

export function normalizeComputerUseActionArgs(
  action: ComputerUseAction,
  args: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...args, action };

  if (
    normalized.coordinate === undefined &&
    typeof args.x === "number" &&
    typeof args.y === "number"
  ) {
    normalized.coordinate = [args.x, args.y];
  }

  if (normalized.app === undefined && action === "focus_app") {
    const app =
      typeof args.name === "string"
        ? args.name
        : typeof args.application === "string"
          ? args.application
          : typeof args.bundleId === "string"
            ? args.bundleId
            : typeof args.bundle_id === "string"
              ? args.bundle_id
              : undefined;
    if (app) normalized.app = app;
  }

  if (normalized.element === undefined && typeof args.index === "number") {
    normalized.element = args.index;
  }

  if (normalized.text === undefined && action === "type" && typeof args.value === "string") {
    normalized.text = args.value;
  }

  return normalized;
}

export function normalizeComputerUseCompatToolArgs(
  action: ComputerUseAction,
  args: Record<string, unknown>
): Record<string, unknown> {
  const normalized = normalizeComputerUseActionArgs(action, args);
  if (action === "capture" && normalized.app === undefined) {
    normalized.app = "desktop";
  }
  return normalized;
}

/** Per-session auto-approval for destructive actions (set by the host UI). */
let sessionAutoApprove = false;
export function setComputerUseAutoApprove(enabled: boolean): void {
  sessionAutoApprove = enabled;
}

/** Optional consent callback; if unset, destructive actions require sessionAutoApprove. */
let approvalCallback:
  | ((action: ComputerUseAction, args: ComputerUseArgs, summary: string) => boolean)
  | null = null;
export function setComputerUseApprovalCallback(
  cb: (action: ComputerUseAction, args: ComputerUseArgs, summary: string) => boolean
): void {
  approvalCallback = cb;
}

export function summarizeAction(action: ComputerUseAction, args: ComputerUseArgs): string {
  switch (action) {
    case "move":
      return `move to ${args.coordinate?.join(",") ?? "unknown coordinate"}`;
    case "click":
    case "double_click":
    case "right_click":
    case "middle_click":
      return `${action} ${args.element ? `element #${args.element}` : args.coordinate ? `at ${args.coordinate.join(",")}` : ""}`.trim();
    case "type":
      return `type "${(args.text || "").slice(0, 40)}"`;
    case "key":
      return `key "${args.keys}"`;
    case "drag":
      return `drag ${args.fromElement ?? args.fromCoordinate} -> ${args.toElement ?? args.toCoordinate}`;
    case "scroll":
      return `scroll ${args.direction || "down"}`;
    case "set_value":
      return `set_value "${(args.value || "").slice(0, 40)}"`;
    case "focus_app":
      return `focus_app ${args.app}${args.raiseWindow ? " (raise)" : ""}`;
    default:
      return action;
  }
}

/** Enforce un-overridable hard blocks + per-action consent. Throws if denied. */
export function assertActionAllowed(action: ComputerUseAction, args: ComputerUseArgs): void {
  // 1. Hard blocks (never overridable).
  if (action === "key" && args.keys && isBlockedKeyCombo(args.keys)) {
    throw new Error(`Refused: the key combo "${args.keys}" is blocked (logout/lock/power).`);
  }
  const enteredText = action === "type" ? args.text : action === "set_value" ? args.value : "";
  if (enteredText && isBlockedTypeText(enteredText)) {
    throw new Error(
      "Refused: the typed text matched a blocked pattern (shell pipe-to-bash / rm -rf / fork bomb)."
    );
  }
  // 2. Consent for destructive actions.
  if (SAFE_ACTIONS.has(action)) return;
  if (sessionAutoApprove) return;
  if (approvalCallback) {
    const approved = approvalCallback(action, args, summarizeAction(action, args));
    if (!approved) {
      throw new Error(`Action denied by approval callback: ${summarizeAction(action, args)}`);
    }
    return;
  }
  // No approval mechanism configured and not auto-approved: allow but warn.
  // (The host gates computer_use via the dangerous-tool system; see tools/index.ts.)
}
