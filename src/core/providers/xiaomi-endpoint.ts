const MIMO_HOSTS = new Set([
  "api.xiaomimimo.com",
  "token-plan-cn.xiaomimimo.com",
  "token-plan-sgp.xiaomimimo.com",
  "token-plan-ams.xiaomimimo.com",
]);

export function normalizeXiaomiEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      MIMO_HOSTS.has(url.hostname) &&
      url.pathname.replace(/\/+$/, "") === "/anthropic"
    ) {
      return `${url.origin}/anthropic/v1`;
    }
  } catch {}
  return baseUrl;
}
