interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeMs: number;
}

interface CircuitState {
  state: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureTime: number;
  successesSinceHalfOpen: number;
}

const rateLimits: Record<string, { count: number; resetTime: number }> = {};
const circuitBreakers = new Map<string, CircuitState>();
const defaultBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 30_000,
};

export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = rateLimits[key];
  if (!record || now > record.resetTime) {
    rateLimits[key] = { count: 1, resetTime: now + config.windowMs };
    return { allowed: true, remaining: config.maxRequests - 1, resetTime: now + config.windowMs };
  }
  if (record.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }
  record.count += 1;
  return {
    allowed: true,
    remaining: config.maxRequests - record.count,
    resetTime: record.resetTime,
  };
}

export function getRateLimitStatus(key: string): { remaining: number; resetTime: number } {
  const record = rateLimits[key];
  if (!record || Date.now() > record.resetTime) {
    return { remaining: 100, resetTime: Date.now() + 60_000 };
  }
  return { remaining: 100 - record.count, resetTime: record.resetTime };
}

export function getCircuitState(service: string): CircuitState | undefined {
  return circuitBreakers.get(service);
}

export function checkCircuit(
  service: string,
  config: CircuitBreakerConfig = defaultBreakerConfig
): { allowed: boolean; state: string } {
  const state = circuitBreakers.get(service);
  if (!state) return { allowed: true, state: "closed" };
  if (state.state === "open" && Date.now() - state.lastFailureTime >= config.recoveryTimeMs) {
    state.state = "half-open";
    state.successesSinceHalfOpen = 0;
    return { allowed: true, state: "half-open" };
  }
  if (state.state === "open") return { allowed: false, state: "open" };
  return { allowed: true, state: state.state };
}

export function recordCircuitSuccess(service: string): void {
  circuitBreakers.delete(service);
}

export function recordCircuitFailure(
  service: string,
  config: CircuitBreakerConfig = defaultBreakerConfig
): void {
  let state = circuitBreakers.get(service);
  if (!state) {
    state = {
      state: "closed",
      failureCount: 0,
      lastFailureTime: Date.now(),
      successesSinceHalfOpen: 0,
    };
    circuitBreakers.set(service, state);
  }
  state.failureCount += 1;
  state.lastFailureTime = Date.now();
  if (state.failureCount >= config.failureThreshold) state.state = "open";
}
