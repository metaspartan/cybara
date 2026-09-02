export type BrowserPreviewStreamInput =
  | { type: "scroll"; deltaX: number; deltaY: number }
  | { type: "pointer_click"; x: number; y: number }
  | { type: "pointer_move"; x: number; y: number }
  | { type: "pointer_down"; x: number; y: number }
  | { type: "pointer_up"; x: number; y: number }
  | { type: "keyboard"; key: string }
  | { type: "text"; text: string };

export type BrowserPreviewStreamSender = (input: BrowserPreviewStreamInput) => boolean;

export interface BrowserPreviewFrameSize {
  width: number;
  height: number;
}

export function containBrowserPreviewFrame(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): BrowserPreviewFrameSize {
  const normalizedWidth = Math.max(1, Math.round(width));
  const normalizedHeight = Math.max(1, Math.round(height));
  const scale = Math.min(1, maxWidth / normalizedWidth, maxHeight / normalizedHeight);
  return {
    width: Math.max(1, Math.round(normalizedWidth * scale)),
    height: Math.max(1, Math.round(normalizedHeight * scale)),
  };
}

export class LatestBrowserFrameDecoder<DecodedFrame> {
  private queued: Blob | null = null;
  private decoding = false;
  private disposed = false;
  private version = 0;

  constructor(
    private readonly decode: (frame: Blob) => Promise<DecodedFrame>,
    private readonly present: (frame: DecodedFrame) => void,
    private readonly discard: (frame: DecodedFrame) => void
  ) {}

  enqueue(frame: Blob): void {
    if (this.disposed) return;
    this.version += 1;
    this.queued = frame;
    void this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.queued = null;
  }

  private drain(): void {
    if (this.decoding || this.disposed) return;
    const frame = this.queued;
    if (!frame) return;
    this.queued = null;
    this.decoding = true;
    void this.decode(frame)
      .then(
        (source) => {
          if (this.disposed) this.discard(source);
          else this.present(source);
        },
        () => undefined
      )
      .finally(() => {
        this.decoding = false;
        if (!this.disposed && this.queued) this.drain();
      });
  }
}
