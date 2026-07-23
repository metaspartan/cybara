import { useEffect, useRef, useState } from "react";
import { createAuthenticatedWebSocket, withGatewayBasePath } from "@/lib/auth";
import { decodeBrowserPreviewImage } from "./browserPreviewInteraction";
import { LatestBrowserFrameDecoder } from "./browserPreviewStreamClient";

interface BrowserPreviewImageProps {
  pageId: string | null;
  visible: boolean;
  fallbackSource: string | null;
  quality: number;
  maxWidth: number;
  maxHeight: number;
  onConnectionChange: (connected: boolean) => void;
  onFramePresented: (presented: boolean) => void;
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
  onConnectionChange,
  onFramePresented,
}: BrowserPreviewImageProps) {
  const [streamSource, setStreamSource] = useState<string | null>(null);
  const connectionChangeRef = useRef(onConnectionChange);
  const framePresentedRef = useRef(onFramePresented);

  useEffect(() => {
    connectionChangeRef.current = onConnectionChange;
    framePresentedRef.current = onFramePresented;
  }, [onConnectionChange, onFramePresented]);

  useEffect(() => {
    return () => {
      if (streamSource?.startsWith("blob:")) URL.revokeObjectURL(streamSource);
    };
  }, [streamSource]);

  useEffect(() => {
    setStreamSource(null);
    framePresentedRef.current(false);
    if (!visible || !pageId) {
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
      (source) => {
        setStreamSource(source);
        framePresentedRef.current(true);
      },
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
        connectionChangeRef.current(true);
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, 15_000);
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") return;
        const frame = frameBlob(event.data);
        if (frame) decoder.enqueue(frame);
      };
      socket.onclose = () => {
        connectionChangeRef.current(false);
        setStreamSource(null);
        framePresentedRef.current(false);
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
      connectionChangeRef.current(false);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      socket?.close();
    };
  }, [maxHeight, maxWidth, pageId, quality, visible]);

  const source = streamSource ?? fallbackSource;
  return source ? (
    <img
      src={source}
      alt="Browser preview"
      className="absolute inset-0 h-full w-full select-none object-contain"
      decoding="async"
      draggable={false}
    />
  ) : null;
}
