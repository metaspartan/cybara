import { timingSafeEqual } from "crypto";

/**
 * Constant-time string equality for secret/token/signature comparisons. Uses
 * crypto.timingSafeEqual so an attacker cannot recover the expected value
 * byte-by-byte via response timing. Returns false on a length mismatch (the
 * length itself is not secret) before the constant-time compare.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
