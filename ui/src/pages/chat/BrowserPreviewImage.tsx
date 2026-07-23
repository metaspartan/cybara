import { type MutableRefObject, useEffect, useRef } from "react";
import { createAuthenticatedWebSocket, withGatewayBasePath } from "@/lib/auth";
import { decodeBrowserPreviewImage } from "./browserPreviewInteraction";
import {
  type BrowserPreviewStreamSender,
  LatestBrowserFrameDecoder,
} from "./browserPreviewStreamClient";

interface BrowserPreviewImageProps {
  pageId: string | null;
  visible: boolean;
  fallbackSource: string | null;
  quality: number;
  maxWidth: number;
  maxHeight: number;
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

export function BrowserPreviewImage({
  pageId,
  visible,
  fallbackSource,
  quality,
  maxWidth,
  maxHeight,
  inputSenderRef,
  onConnectionChange,
  onFramePresented,
  onStreamError,
}: BrowserPreviewImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const streamSourceRef = useRef<string | null>(null);
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
    const previous = streamSourceRef.current;
    streamSourceRef.current = null;
    if (fallbackSource) image.src = fallbackSource;
    else image.removeAttribute("src");
    if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
    framePresentedRef.current(Boolean(fallbackSource));
  }, [fallbackSource]);

  useEffect(() => {
    const releaseStreamSource = (): void => {
      const source = streamSourceRef.current;
      streamSourceRef.current = null;
      if (source?.startsWith("blob:")) URL.revokeObjectURL(source);
    };
    const presentStreamSource = (source: string): void => {
      const image = imageRef.current;
      if (!image) {
        URL.revokeObjectURL(source);
        return;
      }
      const previous = streamSourceRef.current;
      streamSourceRef.current = source;
      image.src = source;
      if (previous?.startsWith("blob:") && previous !== source) URL.revokeObjectURL(previous);
      framePresentedRef.current(true);
    };
    releaseStreamSource();
    framePresentedRef.current(false);
    if (!visible || !pageId) {
      inputSenderRef.current = null;
      connectedRef.current = false;
      connectionChangeRef.current(false);
      return;
    }
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectAttempt = 0;
    const decoder = new LatestBrowserFrameDecoder(
      async (frame) => {
        const source = URL.createObjectURL(frame);
        try {
          await decodeBrowserPreviewImage(source);
          return source;
        } catch (error) {
          URL.revokeObjectURL(source);
          throw error;
        }
      },
      presentStreamSource,
      (source) => URL.revokeObjectURL(source)
    );
    const connect = (): void => {
      if (!active) return;
      const query = new URLSearchParams({
        quality: String(quality),
        maxWidth: String(maxWidth),
        maxHeight: String(maxHeight),
        everyNthFrame: "1",
      });
      socket = createAuthenticatedWebSocket(
        browserStreamUrl(
          `/api/browser/tabs/${encodeURIComponent(pageId)}/stream?${query.toString()}`
        )
      );
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
              (value as { type?: unknown }).type === "input_error" &&
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
        const delay = Math.min(5_000, 250 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      active = false;
      decoder.dispose();
      connectedRef.current = false;
      inputSenderRef.current = null;
      connectionChangeRef.current(false);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      socket?.close();
      releaseStreamSource();
      const image = imageRef.current;
      const fallback = fallbackSourceRef.current;
      if (image && fallback) image.src = fallback;
      else image?.removeAttribute("src");
    };
  }, [inputSenderRef, maxHeight, maxWidth, pageId, quality, visible]);

  return (
    <img
      ref={imageRef}
      alt="Browser preview"
      className="absolute inset-0 h-full w-full select-none object-contain"
      decoding="async"
      draggable={false}
    />
  );
}
