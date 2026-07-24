import { type MutableRefObject, useEffect, useRef } from "react";
import { createHydratedAuthenticatedWebSocket, withGatewayBasePath } from "@/lib/auth";
import {
  type BrowserPreviewStreamSender,
  LatestBrowserFrameDecoder,
} from "./browserPreviewStreamClient";
import { BROWSER_PREVIEW_MAX_HEIGHT, BROWSER_PREVIEW_MAX_WIDTH } from "./browserPreviewTiming";

interface BrowserPreviewImageProps {
  pageId: string | null;
  visible: boolean;
  fallbackSource: string | null;
  quality: number;
  inputSenderRef: MutableRefObject<BrowserPreviewStreamSender | null>;
  onConnectionChange: (connected: boolean) => void;
  onFramePresented: (presented: boolean) => void;
  onStreamError: (message: string) => void;
}

function browserStreamUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${withGatewayBasePath(path)}`;
}

function frameBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value;
  if (value instanceof ArrayBuffer) return new Blob([value], { type: "image/jpeg" });
  return null;
}

interface DecodedBrowserFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeBrowserFrame(frame: Blob): Promise<DecodedBrowserFrame> {
  if (typeof window.createImageBitmap === "function") {
    const bitmap = await window.createImageBitmap(frame);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }
  const source = URL.createObjectURL(frame);
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  try {
    if (typeof image.decode === "function") await image.decode();
    else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Browser preview frame could not be decoded"));
      });
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(source),
    };
  } catch (error) {
    URL.revokeObjectURL(source);
    throw error;
  }
}

export function BrowserPreviewImage({
  pageId,
  visible,
  fallbackSource,
  quality,
  inputSenderRef,
  onConnectionChange,
  onFramePresented,
  onStreamError,
}: BrowserPreviewImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const fallbackSourceRef = useRef(fallbackSource);
  const connectedRef = useRef(false);
  const connectionChangeRef = useRef(onConnectionChange);
  const framePresentedRef = useRef(onFramePresented);
  const streamErrorRef = useRef(onStreamError);

  useEffect(() => {
    connectionChangeRef.current = onConnectionChange;
    framePresentedRef.current = onFramePresented;
    streamErrorRef.current = onStreamError;
  }, [onConnectionChange, onFramePresented, onStreamError]);

  useEffect(() => {
    fallbackSourceRef.current = fallbackSource;
    if (connectedRef.current) return;
    const image = imageRef.current;
    if (!image) return;
    if (fallbackSource) image.src = fallbackSource;
    else image.removeAttribute("src");
    framePresentedRef.current(Boolean(fallbackSource));
  }, [fallbackSource]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let reconnectAttempt = 0;
    let hasStreamFrame = false;
    let streamFrameVersion = 0;
    const clearStreamFrame = (): void => {
      const canvas = canvasRef.current;
      const context = canvasContextRef.current;
      if (canvas) canvas.style.visibility = "hidden";
      hasStreamFrame = false;
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
      canvasContextRef.current = null;
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
    };
    const presentStreamFrame = (frame: DecodedBrowserFrame): void => {
      const canvas = canvasRef.current;
      if (!canvas) {
        frame.release();
        return;
      }
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
        canvasContextRef.current = null;
      }
      const context =
        canvasContextRef.current ?? canvas.getContext("2d", { alpha: false, desynchronized: true });
      canvasContextRef.current = context;
      try {
        context?.drawImage(frame.source, 0, 0, frame.width, frame.height);
        hasStreamFrame = Boolean(context);
        if (context) {
          streamFrameVersion += 1;
          if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
          canvas.style.visibility = "visible";
        }
        framePresentedRef.current(Boolean(context));
      } finally {
        frame.release();
      }
    };
    const presentFallback = (): void => {
      const image = imageRef.current;
      const fallback = fallbackSourceRef.current;
      if (image && fallback) image.src = fallback;
      else image?.removeAttribute("src");
      framePresentedRef.current(Boolean(fallback));
    };
    clearStreamFrame();
    framePresentedRef.current(false);
    if (!visible || !pageId) {
      inputSenderRef.current = null;
      connectedRef.current = false;
      connectionChangeRef.current(false);
      return;
    }
    const decoder = new LatestBrowserFrameDecoder<DecodedBrowserFrame>(
      decodeBrowserFrame,
      presentStreamFrame,
      (frame) => frame.release()
    );
    const connect = async (): Promise<void> => {
      if (!active) return;
      const query = new URLSearchParams({
        quality: String(quality),
        maxWidth: String(BROWSER_PREVIEW_MAX_WIDTH),
        maxHeight: String(BROWSER_PREVIEW_MAX_HEIGHT),
        everyNthFrame: "1",
      });
      const nextSocket = await createHydratedAuthenticatedWebSocket(
        browserStreamUrl(
          `/api/browser/tabs/${encodeURIComponent(pageId)}/stream?${query.toString()}`
        ),
        reconnectAttempt > 0
      );
      if (!active) {
        nextSocket.close();
        return;
      }
      socket = nextSocket;
      socket.binaryType = "blob";
      socket.onopen = () => {
        reconnectAttempt = 0;
        connectedRef.current = true;
        connectionChangeRef.current(true);
        const sender: BrowserPreviewStreamSender = (input) => {
          if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 512_000)
            return false;
          socket.send(JSON.stringify(input));
          return true;
        };
        inputSenderRef.current = sender;
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, 15_000);
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const value: unknown = JSON.parse(event.data);
            if (
              value &&
              typeof value === "object" &&
              ((value as { type?: unknown }).type === "input_error" ||
                (value as { type?: unknown }).type === "error") &&
              typeof (value as { error?: unknown }).error === "string"
            ) {
              streamErrorRef.current((value as { error: string }).error);
            }
          } catch {
            return;
          }
          return;
        }
        const frame = frameBlob(event.data);
        if (frame) decoder.enqueue(frame);
      };
      socket.onclose = () => {
        connectedRef.current = false;
        inputSenderRef.current = null;
        connectionChangeRef.current(false);
        if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        if (!active) return;
        if (!hasStreamFrame) {
          presentFallback();
        } else if (fallbackTimer === null) {
          const frameVersionAtClose = streamFrameVersion;
          fallbackTimer = window.setTimeout(() => {
            fallbackTimer = null;
            if (!active || streamFrameVersion !== frameVersionAtClose) return;
            clearStreamFrame();
            presentFallback();
          }, 750);
        }
        const delay = Math.min(5_000, 250 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(() => void connect(), delay);
      };
    };
    void connect();
    return () => {
      active = false;
      decoder.dispose();
      connectedRef.current = false;
      inputSenderRef.current = null;
      connectionChangeRef.current(false);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      socket?.close();
      clearStreamFrame();
      presentFallback();
    };
  }, [inputSenderRef, pageId, quality, visible]);

  return (
    <>
      <img
        ref={imageRef}
        alt="Browser preview"
        className="absolute inset-0 h-full w-full select-none object-contain"
        decoding="async"
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
        aria-hidden="true"
      />
    </>
  );
}
