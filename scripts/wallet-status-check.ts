// Read-only wallet status probe — uses the live walletManager singleton
// from src/core/wallet.ts. Does NOT call send/swap/sign/execute.
import { walletManager } from "../src/core/wallet.ts";

const status = walletManager.getStatus();
const agentEnabled = walletManager.isAgentAccessEnabled();
const policy = walletManager.getAgentPolicy();

const redacted = (addr?: string) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : undefined;

const summary = {
  available: status.exists,
  unlocked: status.unlocked,
  agentAccessEnabled: agentEnabled,
  primaryAddressEth: redacted(status.primaryAddresses?.eth),
  primaryAddressBtc: redacted(status.primaryAddresses?.btc),
  primaryAddressSol: redacted(status.primaryAddresses?.sol),
  unlockExpiresAt: status.unlockExpiresAt,
  wordCount: status.wordCount,
  kdf: status.kdf
    ? { name: status.kdf.name, iterations: status.kdf.iterations }
    : undefined,
  createdAt: status.createdAt,
  updatedAt: status.updatedAt,
  policy: {
    allowNativeSend: policy.allowNativeSend,
    allowTokenSend: policy.allowTokenSend,
    allowEthContractWrite: policy.allowEthContractWrite,
    allowSolProgramInstruction: policy.allowSolProgramInstruction,
    allowEthSwaps: policy.allowEthSwaps,
    allowDappInteraction: policy.allowDappInteraction,
    allowX402Payments: policy.allowX402Payments,
    x402MaxAmountAtomic: policy.x402MaxAmountAtomic,
    maxSendAmount: policy.maxSendAmount,
    allowedSendRecipientsCount: policy.allowedSendRecipients?.length ?? 0,
    allowedEthContractsCount: policy.allowedEthContracts?.length ?? 0,
    allowedSolProgramsCount: policy.allowedSolPrograms?.length ?? 0,
    allowedDappHostsCount: policy.allowedDappHosts?.length ?? 0,
    allowedX402NetworksCount: policy.allowedX402Networks?.length ?? 0,
  },
};

console.log(JSON.stringify(summary, null, 2));