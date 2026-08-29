import type { SecurityCheckResult } from "./security";

export interface ApiRouteRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  ip?: string;
  security?: SecurityCheckResult;
}

export interface ApiRouteResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  raw?: boolean;
}

export type ApiRouteHandler = (request: ApiRouteRequest) => Promise<ApiRouteResponse>;

export function createLazyApiRouteHandler(load: () => Promise<ApiRouteHandler>): ApiRouteHandler {
  let handlerPromise: Promise<ApiRouteHandler> | undefined;
  return async (request): Promise<ApiRouteResponse> => {
    handlerPromise ??= load();
    const handler = await handlerPromise;
    return handler(request);
  };
}
