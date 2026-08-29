import { handleChat } from "./chat-runtime";
import { getClientIp } from "./client-ip";
import type { ApiRouteHandler, ApiRouteResponse } from "./lazy-route-handler";
import { classifyApiRequestError } from "./request-error";
import {
  buildCorsHeaders,
  logRequest,
  recordApiMetrics,
  securityHeaders,
} from "./routes/request-runtime";
import { securityCheck } from "./security";

export const handleLightweightChatRequest: ApiRouteHandler = async (
  request
): Promise<ApiRouteResponse> => {
  const startedAt = Date.now();
  const url = new URL(request.url, `http://${request.headers.host || "localhost:4269"}`);
  const method = request.method || "POST";
  const path = url.pathname;
  const corsHeaders = buildCorsHeaders(request.headers.origin || request.headers.Origin);
  const clientIp = getClientIp(request.headers, request.ip);
  const security = request.security ?? securityCheck(method, path, request.headers, clientIp);
  if (!security.passed) {
    return {
      status: security.statusCode || 403,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: { error: security.error },
    };
  }
  try {
    const data = request.body as {
      message: string;
      agentId?: string;
      sessionId?: string;
      model?: string;
      modelOverride?: string;
      clientPendingId?: string;
      workspaceDir?: string | null;
      stream?: boolean;
      tools?: boolean;
      images?: Array<{ data?: string; url?: string; mimeType?: string }>;
      queueMode?: "queue" | "steer";
      useModelRouter?: boolean;
    };
    const modelOverride =
      typeof data.modelOverride === "string" && data.modelOverride.trim()
        ? data.modelOverride.trim()
        : typeof data.model === "string" && data.model.trim()
          ? data.model.trim()
          : undefined;
    const result = await handleChat({ ...data, modelOverride });
    const durationMs = Date.now() - startedAt;
    recordApiMetrics(method, path, 200, durationMs);
    logRequest({ timestamp: new Date().toISOString(), method, path, status: 200, durationMs });
    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: result,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const classified = classifyApiRequestError(errorMessage);
    const userMessage =
      process.env.NODE_ENV === "development"
        ? classified.userMessage
        : classified.userMessage.replace(
            /(?:[A-Za-z]:)?[\\/](?:Users|home|private|var|tmp|opt)[\\/][^\s"']*/g,
            "[path]"
          );
    recordApiMetrics(method, path, classified.statusCode, durationMs);
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: classified.statusCode,
      durationMs,
      error: errorMessage,
    });
    return {
      status: classified.statusCode,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: {
        error: userMessage,
        code: classified.errorCode,
        message: process.env.NODE_ENV === "development" ? errorMessage : undefined,
        path,
        timestamp: new Date().toISOString(),
      },
    };
  }
};
