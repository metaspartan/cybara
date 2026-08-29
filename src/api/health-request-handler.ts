import { getClientIp } from "./client-ip";
import type { ApiRouteHandler, ApiRouteResponse } from "./lazy-route-handler";
import { healthRoutes } from "./routes/health";
import { isRawHttpResponse } from "./routes/raw-http-response";
import {
  buildCorsHeaders,
  logRequest,
  recordApiMetrics,
  securityHeaders,
} from "./routes/request-runtime";
import { securityCheck } from "./security";

const supportedHealthRoutes = new Set(Object.keys(healthRoutes));

export function isLightweightHealthRequest(method: string, pathname: string): boolean {
  return supportedHealthRoutes.has(`${method} ${pathname}`);
}

export const handleLightweightHealthRequest: ApiRouteHandler = async (
  request
): Promise<ApiRouteResponse> => {
  const startedAt = Date.now();
  const url = new URL(request.url, `http://${request.headers.host || "localhost:4269"}`);
  const method = request.method || "GET";
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
  const handler = healthRoutes[`${method} ${path}`];
  if (!handler) {
    return {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders, ...securityHeaders },
      body: { error: "Not found" },
    };
  }
  try {
    const result = await handler(
      request.body,
      {},
      {
        clientIp,
        headers: request.headers,
        rawBody: request.rawBody,
        url: request.url,
        auth: security.auth,
      }
    );
    const durationMs = Date.now() - startedAt;
    const status = isRawHttpResponse(result) ? result.status : 200;
    recordApiMetrics(method, path, status, durationMs);
    logRequest({ timestamp: new Date().toISOString(), method, path, status, durationMs });
    return {
      status,
      headers: {
        "Content-Type": isRawHttpResponse(result) ? result.contentType : "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: isRawHttpResponse(result) ? result.body : result,
      raw: isRawHttpResponse(result),
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    recordApiMetrics(method, path, 500, durationMs);
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: 500,
      durationMs,
      error: message,
    });
    return {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: {
        error: "An error occurred while processing your request.",
        code: "INTERNAL_ERROR",
        path,
        timestamp: new Date().toISOString(),
      },
    };
  }
};
