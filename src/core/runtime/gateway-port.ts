export function gatewayPortCandidates(preferredPort: number, fallbackCount: number): number[] {
  const normalizedCount =
    Number.isInteger(fallbackCount) && fallbackCount >= 0 ? Math.min(fallbackCount, 100) : 0;
  const candidates: number[] = [];
  for (let offset = 0; offset <= normalizedCount; offset += 1) {
    const port = preferredPort + offset;
    if (port > 65535) break;
    candidates.push(port);
  }
  return candidates;
}

export function gatewayPortFallbackCount(value: string | undefined): number {
  if (value === undefined) return 0;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? Math.min(count, 100) : 0;
}

export function gatewayPortSignal(port: number): string {
  return `CYBARA_GATEWAY_PORT=${port}`;
}
