export interface RouteMatch {
  routeKey: string | null;
  params: Record<string, string>;
}

interface CompiledRoute {
  routeKey: string;
  parts: string[];
  dynamicSegments: number;
  staticSegments: number;
}

export interface RouteMatcher {
  match(method: string, path: string): RouteMatch;
}

function compileRoute(routeKey: string): { method: string; route: CompiledRoute } | null {
  const separator = routeKey.indexOf(" ");
  if (separator <= 0 || separator === routeKey.length - 1) return null;
  const method = routeKey.slice(0, separator);
  const parts = routeKey.slice(separator + 1).split("/");
  const dynamicSegments = parts.reduce((count, part) => count + (part.startsWith(":") ? 1 : 0), 0);
  return {
    method,
    route: {
      routeKey,
      parts,
      dynamicSegments,
      staticSegments: parts.length - dynamicSegments,
    },
  };
}

export function createRouteMatcher(routeKeys: string[]): RouteMatcher {
  const routesByMethod = new Map<string, Map<number, CompiledRoute[]>>();
  for (const routeKey of routeKeys) {
    const compiled = compileRoute(routeKey);
    if (!compiled) continue;
    let byLength = routesByMethod.get(compiled.method);
    if (!byLength) {
      byLength = new Map<number, CompiledRoute[]>();
      routesByMethod.set(compiled.method, byLength);
    }
    const matchingLength = byLength.get(compiled.route.parts.length) ?? [];
    matchingLength.push(compiled.route);
    matchingLength.sort(
      (left, right) =>
        left.dynamicSegments - right.dynamicSegments || right.staticSegments - left.staticSegments
    );
    byLength.set(compiled.route.parts.length, matchingLength);
  }

  return {
    match(method: string, path: string): RouteMatch {
      const actualParts = path.split("/");
      const candidates = routesByMethod.get(method)?.get(actualParts.length) ?? [];
      for (const candidate of candidates) {
        const params: Record<string, string> = {};
        let matches = true;
        for (let index = 0; index < candidate.parts.length; index++) {
          const routePart = candidate.parts[index];
          const actualPart = actualParts[index];
          if (routePart.startsWith(":")) {
            params[routePart.slice(1)] = actualPart;
          } else if (routePart !== actualPart) {
            matches = false;
            break;
          }
        }
        if (matches) return { routeKey: candidate.routeKey, params };
      }
      return { routeKey: null, params: {} };
    },
  };
}
