export class LatestBrowserFrameDecoder {
  private queued: Blob | null = null;
  private decoding = false;
  private disposed = false;

  constructor(
    private readonly decode: (frame: Blob) => Promise<string>,
    private readonly present: (source: string) => void,
    private readonly discard: (source: string) => void
  ) {}

  enqueue(frame: Blob): void {
    if (this.disposed) return;
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
