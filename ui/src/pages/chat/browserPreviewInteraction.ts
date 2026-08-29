export interface BrowserScrollDelta {
  deltaX: number;
  deltaY: number;
}

export interface BrowserPreviewFrameSource {
  screenshot: string;
}

export interface BrowserPointerPoint {
  x: number;
  y: number;
}

export interface BrowserKeyboardEventLike {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export const BROWSER_SCROLL_FRAME_MS = 8;
export const BROWSER_POINTER_FRAME_MS = 16;
export const BROWSER_PREVIEW_REFRESH_MS = 90;
export const BROWSER_SCROLL_DELTA_LIMIT = 4_000;

function boundedDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BROWSER_SCROLL_DELTA_LIMIT, Math.max(-BROWSER_SCROLL_DELTA_LIMIT, value));
}

export function normalizeBrowserWheelDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number
): BrowserScrollDelta {
  const scale = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(320, viewportHeight) : 1;
  return {
    deltaX: boundedDelta(deltaX * scale),
    deltaY: boundedDelta(deltaY * scale),
  };
}

export function mergeBrowserScrollDelta(
  current: BrowserScrollDelta,
  incoming: BrowserScrollDelta
): BrowserScrollDelta {
  return {
    deltaX: boundedDelta(current.deltaX + incoming.deltaX),
    deltaY: boundedDelta(current.deltaY + incoming.deltaY),
  };
}

const BROWSER_NAMED_KEYS = new Set([
  "Backspace",
  "Delete",
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
]);

export function browserPreviewKeyboardKey(event: BrowserKeyboardEventLike): string | null {
  if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return null;
  const commandModifier = event.metaKey || event.ctrlKey || event.altKey;
  const supportedKey =
    event.key.length === 1 ||
    BROWSER_NAMED_KEYS.has(event.key) ||
    /^F(?:[1-9]|1[0-2])$/.test(event.key);
  if (!supportedKey) return null;
  if (!commandModifier) return event.key;
  const modifiers = [
    event.metaKey ? "Meta" : "",
    event.ctrlKey ? "Control" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}

export class BrowserPointerMoveBatcher {
  private pending: BrowserPointerPoint | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private disposed = false;

  constructor(
    private readonly handler: (point: BrowserPointerPoint) => Promise<void>,
    private readonly frameMs = BROWSER_POINTER_FRAME_MS,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  enqueue(point: BrowserPointerPoint): void {
    if (this.disposed) return;
    this.pending = point;
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.active || this.timer !== null || !this.pending) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      Math.max(0, this.frameMs)
    );
  }

  private async flush(): Promise<void> {
    if (this.active || this.disposed || !this.pending) return;
    const point = this.pending;
    this.pending = null;
    this.active = true;
    try {
      await this.handler(point);
    } catch (error) {
      this.onError(error);
    } finally {
      this.active = false;
      if (!this.disposed && this.pending) this.schedule();
    }
  }
}

export class BrowserScrollBatcher {
  private pending: BrowserScrollDelta = { deltaX: 0, deltaY: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private disposed = false;
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly handler: (delta: BrowserScrollDelta) => Promise<void>,
    private readonly frameMs = BROWSER_SCROLL_FRAME_MS,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  enqueue(delta: BrowserScrollDelta): void {
    if (this.disposed) return;
    this.pending = mergeBrowserScrollDelta(this.pending, delta);
    this.schedule();
  }

  async whenIdle(): Promise<void> {
    if (!this.active && this.timer === null && this.isPendingEmpty()) return;
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  dispose(): void {
    this.disposed = true;
    this.pending = { deltaX: 0, deltaY: 0 };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.active) this.resolveIdle();
  }

  private schedule(): void {
    if (this.active || this.timer !== null || this.isPendingEmpty()) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      Math.max(0, this.frameMs)
    );
  }

  private async flush(): Promise<void> {
    if (this.active || this.disposed || this.isPendingEmpty()) return;
    const delta = this.pending;
    this.pending = { deltaX: 0, deltaY: 0 };
    this.active = true;
    try {
      await this.handler(delta);
    } catch (error) {
      this.onError(error);
    } finally {
      this.active = false;
      if (!this.disposed && !this.isPendingEmpty()) this.schedule();
      else this.resolveIdle();
    }
  }

  private isPendingEmpty(): boolean {
    return this.pending.deltaX === 0 && this.pending.deltaY === 0;
  }

  private resolveIdle(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

export function decodeBrowserPreviewImage(source: string): Promise<void> {
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  if (typeof image.decode === "function") return image.decode();
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Browser preview frame could not be decoded"));
  });
}

export class BrowserFramePresenter<Frame extends BrowserPreviewFrameSource> {
  private sequence = 0;
  private presentedSource = "";
  private disposed = false;

  constructor(
    private readonly decode: (source: string) => Promise<void>,
    private readonly present: (frame: Frame) => void,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  enqueue(frame: Frame): void {
    if (this.disposed) return;
    const sequence = ++this.sequence;
    if (frame.screenshot === this.presentedSource) {
      this.present(frame);
      return;
    }
    void this.decode(frame.screenshot).then(
      () => {
        if (this.disposed || sequence !== this.sequence) return;
        this.presentedSource = frame.screenshot;
        this.present(frame);
      },
      (error: unknown) => {
        if (!this.disposed && sequence === this.sequence) this.onError(error);
      }
    );
  }

  reset(): void {
    this.sequence += 1;
    this.presentedSource = "";
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
