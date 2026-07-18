export interface WalletAgentLimits {
  allowedSendRecipients: string[];
  maxSendAmount: string;
}

export function assertRecipientAllowed(
  recipient: string | undefined,
  limits: WalletAgentLimits
): void {
  const target = String(recipient || "").trim();
  if (!target) return;
  const allow = limits.allowedSendRecipients.map((address) => address.trim().toLowerCase());
  if (!allow.includes(target.toLowerCase())) {
    throw new Error(
      "Validation error: Recipient is not in the agent send allowlist (wallet policy)"
    );
  }
}

export function assertAmountWithinCap(amount: string | undefined, limits: WalletAgentLimits): void {
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

export function assertSendWithinPolicy(
  recipient: string | undefined,
  amount: string | undefined,
  limits: WalletAgentLimits
): void {
  assertRecipientAllowed(recipient, limits);
  assertAmountWithinCap(amount, limits);
}
