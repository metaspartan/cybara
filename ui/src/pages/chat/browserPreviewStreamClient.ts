export type BrowserPreviewStreamInput =
  | { type: "scroll"; deltaX: number; deltaY: number }
  | { type: "pointer_click"; x: number; y: number }
  | { type: "keyboard"; key: string };

export type BrowserPreviewStreamSender = (input: BrowserPreviewStreamInput) => boolean;

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
    const frameVersion = this.version;
    this.queued = null;
    this.decoding = true;
    void this.decode(frame)
      .then(
        (source) => {
          if (this.disposed || this.version !== frameVersion) this.discard(source);
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
