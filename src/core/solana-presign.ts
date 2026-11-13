import {
  ComputeBudgetProgram,
  MessageV0,
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type AddressLookupTableAccount,
  type RpcResponseAndContext,
  type SimulatedTransactionResponse,
  type VersionedMessage,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./solana-token";

export interface PresignConnection {
  getMultipleAccountsInfo(publicKeys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]>;
  getAddressLookupTable?(
    accountKey: PublicKey
  ): Promise<RpcResponseAndContext<AddressLookupTableAccount | null>>;
  simulateTransaction(
    transaction: VersionedTransaction,
    config: { sigVerify: false; replaceRecentBlockhash: true }
  ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>>;
}

export interface PresignExpectedSwap {
  inputMint?: string;
  outputMint?: string;
  minAmountOutRaw?: string;
}

export interface PresignTokenTransfer {
  mint: string;
  source: string;
  destination: string;
  sourceOwner: string | null;
  destinationOwner: string | null;
  amountRaw: bigint | null;
}

export interface PresignCheckResult {
  ok: boolean;
  violations: string[];
  transfers: PresignTokenTransfer[];
  simulated: boolean;
}

interface PresignSystemTransfer {
  destination: string;
  lamports: bigint;
}

interface PresignCloseAccount {
  destination: string;
}

interface PresignCompiledInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Buffer;
}

const TOKEN_TRANSFER_INSTRUCTION = 3;
const TOKEN_CLOSE_ACCOUNT_INSTRUCTION = 9;
const TOKEN_TRANSFER_CHECKED_INSTRUCTION = 12;
const SYSTEM_TRANSFER_INSTRUCTION = 2;
const SYSTEM_CREATE_ACCOUNT_INSTRUCTION = 0;
const TOKEN_ACCOUNT_MIN_SIZE = 64;
const MINT_KEY_OFFSET = 0;
const OWNER_KEY_OFFSET = 32;
const KEY_SIZE = 32;
const AMOUNT_OFFSET = 1;
const AMOUNT_SIZE = 8;
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function readU64(data: Buffer, offset: number): bigint | null {
  if (data.length < offset + AMOUNT_SIZE) return null;
  return data.readBigUInt64LE(offset);
}

function toBase58(key: PublicKey): string {
  return key.toBase58();
}

function collectCompiledInstructions(message: VersionedMessage): PresignCompiledInstruction[] {
  if (message instanceof MessageV0) {
    return message.compiledInstructions.map((compiled) => ({
      programIdIndex: compiled.programIdIndex,
      accountIndexes: [...compiled.accountKeyIndexes],
      data: Buffer.from(compiled.data),
    }));
  }
  return message.compiledInstructions.map((compiled) => ({
    programIdIndex: compiled.programIdIndex,
    accountIndexes: compiledAccountIndexes(compiled),
    data: Buffer.from(compiled.data),
  }));
}

function compiledAccountIndexes(compiled: object): number[] {
  if ("accountKeyIndexes" in compiled) {
    return [...(compiled.accountKeyIndexes as number[])];
  }
  if ("accountKeyIndex" in compiled) {
    return [compiled.accountKeyIndex as number];
  }
  return [];
}

function parseTokenAccount(info: AccountInfo<Buffer>): { mint: string; owner: string } | null {
  if (info.data.length < TOKEN_ACCOUNT_MIN_SIZE) return null;
  const mint = new PublicKey(info.data.subarray(MINT_KEY_OFFSET, MINT_KEY_OFFSET + KEY_SIZE));
  const owner = new PublicKey(info.data.subarray(OWNER_KEY_OFFSET, OWNER_KEY_OFFSET + KEY_SIZE));
  return { mint: toBase58(mint), owner: toBase58(owner) };
}

async function fetchAccountOwners(
  connection: PresignConnection,
  addresses: string[]
): Promise<Map<string, { mint: string; owner: string } | null>> {
  const resolved = new Map<string, { mint: string; owner: string } | null>();
  if (addresses.length === 0) return resolved;
  const keys = addresses.map((address) => new PublicKey(address));
  const infos = await connection.getMultipleAccountsInfo(keys);
  keys.forEach((key, index) => {
    const info = infos[index];
    resolved.set(toBase58(key), info ? parseTokenAccount(info) : null);
  });
  return resolved;
}

async function resolveAccountKeys(
  connection: PresignConnection,
  tx: VersionedTransaction
): Promise<PublicKey[]> {
  const message = tx.message;
  const staticKeys = message.staticAccountKeys;
  const lookups = message instanceof MessageV0 ? (message.addressTableLookups ?? []) : [];
  const dynamic: PublicKey[] = [];
  for (const lookup of lookups) {
    if (!connection.getAddressLookupTable) break;
    const table = await connection.getAddressLookupTable(lookup.accountKey);
    const addresses = table?.value?.state?.addresses;
    if (addresses) {
      dynamic.push(...addresses);
    }
  }
  return [...staticKeys, ...dynamic];
}

function decodePresignActions(
  accountKeys: PublicKey[],
  compiled: PresignCompiledInstruction[]
): {
  tokenTransfers: PresignTokenTransfer[];
  systemTransfers: PresignSystemTransfer[];
  closeAccounts: PresignCloseAccount[];
  createAccountOwners: string[];
  unresolved: string[];
} {
  const tokenTransfers: PresignTokenTransfer[] = [];
  const systemTransfers: PresignSystemTransfer[] = [];
  const closeAccounts: PresignCloseAccount[] = [];
  const createAccountOwners: string[] = [];
  const unresolved: string[] = [];

  const keyAt = (index: number): string | null => {
    const key = accountKeys[index];
    if (!key) return null;
    return toBase58(key);
  };

  for (const compiledInstruction of compiled) {
    const programId = keyAt(compiledInstruction.programIdIndex);
    if (!programId) {
      unresolved.push(`instruction ${compiledInstruction.programIdIndex}`);
      continue;
    }
    const accounts = compiledInstruction.accountIndexes.map(keyAt);
    const opcode = compiledInstruction.data[0];

    if (
      programId === TOKEN_PROGRAM_ID.toBase58() ||
      programId === TOKEN_2022_PROGRAM_ID.toBase58()
    ) {
      if (opcode === TOKEN_TRANSFER_INSTRUCTION) {
        const [source, destination] = accounts;
        tokenTransfers.push({
          mint: "",
          source: source ?? "",
          destination: destination ?? "",
          sourceOwner: null,
          destinationOwner: null,
          amountRaw: readU64(compiledInstruction.data, AMOUNT_OFFSET),
        });
      } else if (opcode === TOKEN_TRANSFER_CHECKED_INSTRUCTION) {
        const [source, mint, destination] = accounts;
        tokenTransfers.push({
          mint: mint ?? "",
          source: source ?? "",
          destination: destination ?? "",
          sourceOwner: null,
          destinationOwner: null,
          amountRaw: readU64(compiledInstruction.data, AMOUNT_OFFSET),
        });
      } else if (opcode === TOKEN_CLOSE_ACCOUNT_INSTRUCTION) {
        closeAccounts.push({ destination: accounts[1] ?? "" });
      }
      continue;
    }

    if (programId === SystemProgram.programId.toBase58()) {
      if (opcode === SYSTEM_TRANSFER_INSTRUCTION) {
        systemTransfers.push({
          destination: accounts[1] ?? "",
          lamports: readU64(compiledInstruction.data, AMOUNT_OFFSET) ?? 0n,
        });
      } else if (opcode === SYSTEM_CREATE_ACCOUNT_INSTRUCTION) {
        if (compiledInstruction.data.length >= AMOUNT_OFFSET + AMOUNT_SIZE + KEY_SIZE) {
          const ownerStart = AMOUNT_OFFSET + AMOUNT_SIZE + 8 + 4;
          const owner = new PublicKey(
            compiledInstruction.data.subarray(ownerStart, ownerStart + KEY_SIZE)
          );
          createAccountOwners.push(toBase58(owner));
        }
      }
      continue;
    }

    if (
      programId === ComputeBudgetProgram.programId.toBase58() ||
      programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    ) {
      continue;
    }
  }

  return {
    tokenTransfers,
    systemTransfers,
    closeAccounts,
    createAccountOwners,
    unresolved,
  };
}

export async function verifySwapBeforeSign(input: {
  connection: PresignConnection;
  transaction: VersionedTransaction;
  owner: string;
  expected?: PresignExpectedSwap;
}): Promise<PresignCheckResult> {
  const violations: string[] = [];
  const owner = input.owner;
  const accountKeys = await resolveAccountKeys(input.connection, input.transaction);
  const feePayer = accountKeys[0] ? toBase58(accountKeys[0]) : null;
  if (feePayer !== owner) {
    violations.push(`fee payer ${feePayer ?? "unknown"} is not the wallet ${owner}`);
  }

  const compiled = collectCompiledInstructions(input.transaction.message);
  const decoded = decodePresignActions(accountKeys, compiled);
  for (const unresolved of decoded.unresolved) {
    violations.push(`could not resolve account for instruction ${unresolved}`);
  }

  const transferAddresses = [
    ...new Set(
      decoded.tokenTransfers.flatMap((transfer) => [transfer.source, transfer.destination])
    ),
  ].filter((address) => address.length > 0);
  const systemDestinations = decoded.systemTransfers
    .map((transfer) => transfer.destination)
    .filter((address) => address.length > 0);
  const accountDetails = await fetchAccountOwners(input.connection, [
    ...transferAddresses,
    ...systemDestinations,
  ]);

  const transfers: PresignTokenTransfer[] = decoded.tokenTransfers.map((transfer) => {
    const sourceDetails = accountDetails.get(transfer.source) ?? null;
    const destinationDetails = accountDetails.get(transfer.destination) ?? null;
    return {
      ...transfer,
      mint: transfer.mint || sourceDetails?.mint || destinationDetails?.mint || "",
      sourceOwner: sourceDetails?.owner ?? null,
      destinationOwner: destinationDetails?.owner ?? null,
    };
  });

  for (const systemTransfer of decoded.systemTransfers) {
    if (systemTransfer.destination === owner) continue;
    const destinationDetails = accountDetails.get(systemTransfer.destination) ?? null;
    if (destinationDetails?.owner === owner) continue;
    violations.push(
      `SOL transfer of ${systemTransfer.lamports} lamports leaves the wallet to ${systemTransfer.destination}`
    );
  }

  for (const closeAccount of decoded.closeAccounts) {
    if (closeAccount.destination !== owner) {
      violations.push(`closed token account sends rent to ${closeAccount.destination}`);
    }
  }

  for (const createAccountOwner of decoded.createAccountOwners) {
    if (
      createAccountOwner !== TOKEN_PROGRAM_ID.toBase58() &&
      createAccountOwner !== TOKEN_2022_PROGRAM_ID.toBase58() &&
      createAccountOwner !== SystemProgram.programId.toBase58()
    ) {
      violations.push(`system account is created with foreign owner program ${createAccountOwner}`);
    }
  }

  if (transfers.length === 0) {
    violations.push("no SPL token transfers found in the transaction");
  }

  const sources = new Set(
    transfers.map((transfer) => transfer.source).filter((source) => source.length > 0)
  );
  const expected = input.expected ?? {};
  const inputMint = expected.inputMint;
  const outputMint = expected.outputMint;

  if (inputMint) {
    for (const transfer of transfers) {
      if (transfer.sourceOwner === owner && transfer.mint !== inputMint) {
        violations.push(`wallet pays in token ${transfer.mint} but requested ${inputMint}`);
      }
    }
  }

  for (const transfer of transfers) {
    if (transfer.destinationOwner === owner) continue;
    if (sources.has(transfer.destination)) continue;
    if (transfer.sourceOwner === owner) continue;
    if (inputMint && transfer.mint === inputMint) continue;
    violations.push(
      `token ${transfer.mint || "unknown"} is paid to ${transfer.destination} owned by ${
        transfer.destinationOwner ?? "unknown"
      } outside the requested swap`
    );
  }

  if (outputMint) {
    const payoutTransfers = transfers.filter(
      (transfer) => transfer.destinationOwner === owner && transfer.mint === outputMint
    );
    const payoutTotal = payoutTransfers.reduce(
      (sum, transfer) => sum + (transfer.amountRaw ?? 0n),
      0n
    );
    if (payoutTotal === 0n) {
      violations.push(`no payout of requested output token ${outputMint} to the wallet`);
    } else if (expected.minAmountOutRaw) {
      const minAmountOut = BigInt(expected.minAmountOutRaw);
      if (payoutTotal < minAmountOut) {
        violations.push(
          `payout ${payoutTotal} is below the accepted minimum ${minAmountOut} for ${outputMint}`
        );
      }
    }
  }

  const simulation = await input.connection.simulateTransaction(input.transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (simulation.value.err) {
    violations.push(`simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  return {
    ok: violations.length === 0,
    violations,
    transfers,
    simulated: true,
  };
}
