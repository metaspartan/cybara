// Tool handlers - HTTP/API operations
import { validateUrl } from "../../../api/security";
import { createLogger } from "../../logger";

const log = createLogger("HTTP");

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  elapsed: number;
}

export async function handleHttp(args: Record<string, unknown>): Promise<HttpResponse> {
  const url = args.url as string;
  const method = (args.method as string) || "GET";
  const headers = (args.headers as Record<string, string>) || {};
  const body = args.body as string | undefined;
  const timeout = (args.timeout as number) || 30000;

  if (!url) {
    throw new Error("URL is required");
  }

  // SSRF Protection: Validate URL before making request
  const urlValidation = await validateUrl(url);
  if (!urlValidation.valid) {
    log.warn(`SSRF blocked: ${urlValidation.error}`, { url });
    throw new Error(`Request blocked: ${urlValidation.error}`);
  }

  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    log.debug(`HTTP ${method} ${url}`);

    const response = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: body ? body : undefined,
      signal: controller.signal,
      redirect: "manual", // Don't auto-follow redirects (prevent SSRF via redirect)
    });

    clearTimeout(timeoutId);

    // If redirect, validate the new URL too
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        const redirectValidation = await validateUrl(new URL(location, url).toString());
        if (!redirectValidation.valid) {
          log.warn(`SSRF blocked redirect: ${redirectValidation.error}`, { location });
          throw new Error(`Redirect blocked: ${redirectValidation.error}`);
        }
        // Follow the validated redirect
        return handleHttp({ ...args, url: new URL(location, url).toString() });
      }
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.text();

    log.debug(`HTTP ${method} ${url} -> ${response.status}`, { elapsed: Date.now() - startTime });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      elapsed: Date.now() - startTime,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const err = error as Error;
    log.error(`HTTP ${method} ${url} failed: ${err.message}`);
    throw new Error(`HTTP request failed: ${err.message}`);
  }
}

// Shorthand for common HTTP methods
export async function handleHttpGet(args: Record<string, unknown>): Promise<HttpResponse> {
  return handleHttp({ ...args, method: "GET" });
}

export async function handleHttpPost(args: Record<string, unknown>): Promise<HttpResponse> {
  return handleHttp({ ...args, method: "POST" });
}

export async function handleHttpPut(args: Record<string, unknown>): Promise<HttpResponse> {
  return handleHttp({ ...args, method: "PUT" });
}

export async function handleHttpDelete(args: Record<string, unknown>): Promise<HttpResponse> {
  return handleHttp({ ...args, method: "DELETE" });
}
