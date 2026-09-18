const PAGE_CURSOR_KEYWORDS = new Set([
  "default",
  "pointer",
  "text",
  "vertical-text",
  "crosshair",
  "move",
  "grab",
  "grabbing",
  "not-allowed",
  "no-drop",
  "wait",
  "progress",
  "help",
  "context-menu",
  "cell",
  "copy",
  "alias",
  "all-scroll",
  "col-resize",
  "row-resize",
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
  "ne-resize",
  "nw-resize",
  "se-resize",
  "sw-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "zoom-in",
  "zoom-out",
  "none",
]);

export const PAGE_CURSOR_PROBE_INTERVAL_MS = 50;

export function normalizePageCursor(value: unknown): string {
  if (typeof value !== "string") return "default";
  const keyword = value.split(",").at(-1)?.trim().toLowerCase() ?? "";
  return PAGE_CURSOR_KEYWORDS.has(keyword) ? keyword : "default";
}

export function pageCursorProbeScript(x: number, y: number): string {
  return `(() => {
  const x = ${Number(x)};
  const y = ${Number(y)};
  let element = document.elementFromPoint(x, y);
  while (element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  if (!element) return "default";
  const style = getComputedStyle(element);
  if (style.cursor && style.cursor !== "auto") return style.cursor;
  if (element.isContentEditable || element.tagName === "TEXTAREA") return "text";
  if (element.tagName === "INPUT") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "email", "url", "tel", "password", "number"].includes(type)
      ? "text"
      : "default";
  }
  if (style.userSelect === "none") return "default";
  const caret = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  const node = caret ? caret.startContainer : null;
  if (!node || node.nodeType !== 3 || !node.textContent || !node.textContent.trim()) return "default";
  const glyph = document.createRange();
  glyph.setStart(node, Math.max(0, caret.startOffset - 1));
  glyph.setEnd(node, Math.min(node.textContent.length, caret.startOffset + 1));
  for (const rect of glyph.getClientRects()) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return "text";
  }
  return "default";
})()`;
}

export class BrowserPreviewCursorTracker {
  private point: { x: number; y: number } | null = null;
  private lastCursor: string | null = null;
  private lastProbeAt = 0;
  private inflight = false;
  private pending = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly probe: (x: number, y: number) => Promise<unknown>,
    private readonly publish: (cursor: string) => void,
    private readonly intervalMs = PAGE_CURSOR_PROBE_INTERVAL_MS
  ) {}

  track(x: number, y: number): void {
    this.point = { x, y };
    this.schedule();
  }

  refresh(): void {
    if (this.point) this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.inflight) {
      this.pending = true;
      return;
    }
    if (this.timer) return;
    const delay = Math.max(0, this.intervalMs - (Date.now() - this.lastProbeAt));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    const point = this.point;
    if (!point || this.disposed) return;
    this.inflight = true;
    this.lastProbeAt = Date.now();
    try {
      const cursor = normalizePageCursor(await this.probe(point.x, point.y));
      if (!this.disposed && cursor !== this.lastCursor) {
        this.lastCursor = cursor;
        this.publish(cursor);
      }
    } catch {
      return;
    } finally {
      this.inflight = false;
      if (this.pending) {
        this.pending = false;
        this.schedule();
      }
    }
  }
}
