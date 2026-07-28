export interface CybaraRouteContext {
  workspacePath?: string;
  filePath?: string;
  line?: number;
}

export function buildCybaraRouteUrl(
  gatewayBase: string,
  route: string,
  context: CybaraRouteContext = {}
): string {
  const url = new URL(route, `${gatewayBase.replace(/\/+$/, "")}/`);
  if (route === "/ide") {
    if (context.workspacePath) url.searchParams.set("workspacePath", context.workspacePath);
    if (context.filePath) url.searchParams.set("path", context.filePath);
    if (context.line && context.line > 0) url.searchParams.set("line", String(context.line));
  } else if (context.workspacePath) {
    url.searchParams.set("workspace", context.workspacePath);
  }
  return url.toString();
}
