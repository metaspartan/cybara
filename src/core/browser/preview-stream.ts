import * as pwManager from "./pw-manager";

export interface BrowserPreviewStreamOptions {
  quality: number;
  maxWidth: number;
  maxHeight: number;
  everyNthFrame: number;
}

export type BrowserPreviewStreamListener = (frame: Buffer) => void;
export type BrowserPreviewStreamStop = () => Promise<void>;
export type BrowserPreviewStreamStarter = (
  pageId: string,
  options: BrowserPreviewStreamOptions,
  listener: (base64Frame: string) => void
) => Promise<BrowserPreviewStreamStop>;

interface BrowserPreviewStreamState {
  listeners: Set<BrowserPreviewStreamListener>;
  latest: Buffer | null;
  start: Promise<void>;
  stop: BrowserPreviewStreamStop | null;
}

export class BrowserPreviewStreamBroker {
  private readonly streams = new Map<string, BrowserPreviewStreamState>();

  constructor(private readonly starter: BrowserPreviewStreamStarter) {}

  async subscribe(
    pageId: string,
    options: BrowserPreviewStreamOptions,
    listener: BrowserPreviewStreamListener
  ): Promise<BrowserPreviewStreamStop> {
    const key = this.streamKey(pageId, options);
    let state = this.streams.get(key);
    if (!state) {
      state = {
        listeners: new Set<BrowserPreviewStreamListener>(),
        latest: null,
        start: Promise.resolve(),
        stop: null,
      };
      this.streams.set(key, state);
      const activeState = state;
      activeState.start = this.starter(pageId, options, (base64Frame) => {
        if (this.streams.get(key) !== activeState) return;
        const frame = Buffer.from(base64Frame, "base64");
        if (frame.length === 0) return;
        activeState.latest = frame;
        for (const subscriber of activeState.listeners) subscriber(frame);
      }).then((stop) => {
        activeState.stop = stop;
      });
    }
    state.listeners.add(listener);
    if (state.latest) listener(state.latest);
    try {
      await state.start;
    } catch (error) {
      state.listeners.delete(listener);
      if (this.streams.get(key) === state) this.streams.delete(key);
      throw error;
    }
    let subscribed = true;
    return async (): Promise<void> => {
      if (!subscribed) return;
      subscribed = false;
      state.listeners.delete(listener);
      if (state.listeners.size > 0 || this.streams.get(key) !== state) return;
      this.streams.delete(key);
      await state.stop?.();
    };
  }

  activeStreamCount(): number {
    return this.streams.size;
  }

  private streamKey(pageId: string, options: BrowserPreviewStreamOptions): string {
    return `${pageId}:${options.quality}:${options.maxWidth}:${options.maxHeight}:${options.everyNthFrame}`;
  }
}

const browserPreviewStreamBroker = new BrowserPreviewStreamBroker(
  async (pageId, options, listener) =>
    await pwManager.startScreencast(pageId, options, (frame) => listener(frame.data))
);

export async function subscribeBrowserPreviewStream(
  pageId: string,
  options: BrowserPreviewStreamOptions,
  listener: BrowserPreviewStreamListener
): Promise<BrowserPreviewStreamStop> {
  return await browserPreviewStreamBroker.subscribe(pageId, options, listener);
}
