import * as pwManager from "./pw-manager";
import { invalidateBrowserPreview } from "./preview-cache";

export type BrowserPreviewInput =
  | { type: "scroll"; deltaX: number; deltaY: number }
  | { type: "pointer_click"; x: number; y: number }
  | { type: "keyboard"; key: string };

export interface BrowserPreviewInputHandlers {
  scroll(pageId: string, deltaX: number, deltaY: number): Promise<void>;
  click(pageId: string, x: number, y: number): Promise<void>;
  keyboard(pageId: string, key: string): Promise<void>;
  invalidate(pageId: string): void;
}

export type BrowserPreviewInputExecutor = (input: BrowserPreviewInput) => Promise<void>;

function boundedScrollDelta(value: number): number {
  return Math.min(4_000, Math.max(-4_000, value));
}

function mergeScrollInput(
  current: Extract<BrowserPreviewInput, { type: "scroll" }>,
  incoming: Extract<BrowserPreviewInput, { type: "scroll" }>
): Extract<BrowserPreviewInput, { type: "scroll" }> {
  return {
    type: "scroll",
    deltaX: boundedScrollDelta(current.deltaX + incoming.deltaX),
    deltaY: boundedScrollDelta(current.deltaY + incoming.deltaY),
  };
}

export class BrowserPreviewInputQueue {
  private readonly queue: BrowserPreviewInput[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private active = false;
  private disposed = false;

  constructor(
    private readonly execute: BrowserPreviewInputExecutor,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  enqueue(input: BrowserPreviewInput): void {
    if (this.disposed) return;
    const last = this.queue.at(-1);
    if (last?.type === "scroll" && input.type === "scroll") {
      this.queue[this.queue.length - 1] = mergeScrollInput(last, input);
    } else {
      this.queue.push(input);
    }
    void this.drain();
  }

  async whenIdle(): Promise<void> {
    if (!this.active && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    if (!this.active) this.resolveIdle();
  }

  private async drain(): Promise<void> {
    if (this.active || this.disposed) return;
    this.active = true;
    while (!this.disposed && this.queue.length > 0) {
      const input = this.queue.shift();
      if (!input) continue;
      try {
        await this.execute(input);
      } catch (error) {
        this.onError(error);
      }
    }
    this.active = false;
    this.resolveIdle();
  }

  private resolveIdle(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

const defaultHandlers: BrowserPreviewInputHandlers = {
  scroll: pwManager.scrollPage,
  click: pwManager.clickAt,
  keyboard: pwManager.sendKey,
  invalidate: invalidateBrowserPreview,
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseBrowserPreviewInput(value: unknown): BrowserPreviewInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.type === "scroll") {
    const deltaX = finiteNumber(input.deltaX);
    const deltaY = finiteNumber(input.deltaY);
    if (deltaX === null || deltaY === null) return null;
    return {
      type: "scroll",
      deltaX: boundedScrollDelta(deltaX),
      deltaY: boundedScrollDelta(deltaY),
    };
  }
  if (input.type === "pointer_click") {
    const x = finiteNumber(input.x);
    const y = finiteNumber(input.y);
    return x === null || y === null || x < 0 || y < 0 || x > 10_000 || y > 10_000
      ? null
      : { type: "pointer_click", x, y };
  }
  if (input.type === "keyboard") {
    const key = typeof input.key === "string" ? input.key : "";
    return key.length > 0 && key.length <= 32 ? { type: "keyboard", key } : null;
  }
  return null;
}

export async function executeBrowserPreviewInput(
  pageId: string,
  input: BrowserPreviewInput,
  handlers: BrowserPreviewInputHandlers = defaultHandlers
): Promise<void> {
  if (input.type === "scroll") await handlers.scroll(pageId, input.deltaX, input.deltaY);
  else if (input.type === "pointer_click") await handlers.click(pageId, input.x, input.y);
  else await handlers.keyboard(pageId, input.key);
  handlers.invalidate(pageId);
}
