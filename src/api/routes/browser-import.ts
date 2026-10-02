import { forwardedClientIp, isLoopbackIp } from "../client-ip";
import { detectBrowserImportSources } from "../../core/browser/import-sources";
import { browserImportStore } from "../../core/browser/import-store";
import { fillImportedBrowserLogin, importBrowserData } from "../../core/browser/import-service";
import { type RouteContext, type RouteHandler, makeRawHttpResponse } from "./_shared";

export function browserImportAccessError(context: RouteContext | undefined): string | null {
  const headers = context?.headers ?? {};
  for (const [key, value] of Object.entries(headers)) {
    if (!["x-forwarded-for", "x-real-ip"].includes(key.toLowerCase())) continue;
    if (value.split(",").some((address) => !isLoopbackIp(address.trim())))
      return "Browser data import is available only from this device.";
  }
  const forwardedIp = forwardedClientIp(context?.headers ?? {});
  if (!isLoopbackIp(context?.clientIp) || (forwardedIp && !isLoopbackIp(forwardedIp)))
    return "Browser data import is available only from this device.";
  if (
    !context?.auth?.authenticated ||
    context.auth.mobileDevice ||
    !(context.headers.authorization || context.headers.Authorization)
  )
    return "Authenticate locally before accessing imported browser data.";
  return null;
}

function localImportRoute(action: (body: unknown) => Promise<unknown> | unknown): RouteHandler {
  return async (body, _params, context) => {
    const denied = browserImportAccessError(context);
    if (denied)
      return makeRawHttpResponse(
        JSON.stringify({ success: false, error: denied }),
        "application/json",
        403
      );
    try {
      return await action(body);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof SyntaxError
            ? "The selected file is not a valid browser export. Check its format and try again."
            : error instanceof Error
              ? error.message
              : "Browser import failed.",
      };
    }
  };
}

export const browserImportRoutes: Record<string, RouteHandler> = {
  "GET /api/browser/import/sources": localImportRoute(async () => ({
    success: true,
    sources: await detectBrowserImportSources(),
    counts: browserImportStore.counts(),
  })),
  "POST /api/browser/import": localImportRoute(async (body) => ({
    success: true,
    ...(await importBrowserData(body)),
  })),
  "GET /api/browser/import/library": localImportRoute(() => ({
    success: true,
    ...browserImportStore.library(),
  })),
  "POST /api/browser/import/fill": localImportRoute(async (body) => {
    await fillImportedBrowserLogin(body);
    return { success: true };
  }),
};
