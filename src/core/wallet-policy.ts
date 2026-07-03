/**
 * Pure agent-authorization checks for the wallet. Extracted from WalletManager
 * so the fund-movement guards can be unit-tested in isolation (and reused by
 * every fund-moving path: sends, token sends, swaps, and contract calls).
 *
 * These enforce the two operator-configured limits that contain a compromised
 * or prompt-injected agent: a recipient allowlist and a per-transaction cap.
 */

export interface WalletAgentLimits {
  /** Lowercased addresses the agent may send to. Empty = no allowlist configured. */
  allowedSendRecipients: string[];
  /** Human-unit per-transaction cap as a string. Empty/invalid = no cap. */
  maxSendAmount: string;
}

/** Throw if `recipient` is set and not in a non-empty allowlist. */
export function assertRecipientAllowed(
  recipient: string | undefined,
  limits: WalletAgentLimits
): void {
  const target = String(recipient || "").trim();
  if (!target) return; // no explicit recipient → funds stay with the wallet
  if (limits.allowedSendRecipients.length > 0) {
    const allow = limits.allowedSendRecipients.map((a) => a.trim().toLowerCase());
    if (!allow.includes(target.toLowerCase())) {
      throw new Error(
        "Validation error: Recipient is not in the agent send allowlist (wallet policy)"
      );
    }
  }
}

/** Throw if `amount` exceeds a configured, positive, finite per-transaction cap. */
export function assertAmountWithinCap(
  amount: string | undefined,
  limits: WalletAgentLimits
): void {
  const cap = Number(limits.maxSendAmount);
  if (limits.maxSendAmount?.trim() && Number.isFinite(cap) && cap > 0) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt > cap) {
      throw new Error(
        `Validation error: Amount (${amount ?? "?"}) exceeds the agent per-transaction cap of ${limits.maxSendAmount} set by wallet policy`
      );
    }
  }
}
