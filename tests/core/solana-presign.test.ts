import { describe, expect, test } from "bun:test";
import {
  ComputeBudgetProgram,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
  type AccountInfo,
  type AddressLookupTableAccount,
  type RpcResponseAndContext,
  type SimulatedTransactionResponse,
  type TransactionInstruction as Web3Instruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "../../src/core/solana-token";
import { verifySwapBeforeSign, type PresignConnection } from "../../src/core/solana-presign";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const BONK_MINT = new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1MpbCex");

const USER_KEY = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const ATTACKER_KEY = new PublicKey("5B8qXMW7Du9QCMLeoDd5NXA4trNWwpAxW39xDs5ozKvq");
const USER_WSOL_ATA = new PublicKey("AVfBkemfA5TDaiPnDkAnPQh8B4x8FM3c6GNAXVp8FSn9");
const USER_USDC_ATA = new PublicKey("BfXJqFmAHCZaWTcrKunQyiHFgPBUrxnPmF5bGejX9Gjt");
const POOL_WSOL_VAULT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
const POOL_USDC_VAULT = new PublicKey("DmHcksTYXsbzKGTKUiyRoHbrHzYdFLzVbcmdhMyMuqvw");
const ATTACKER_USDC_ATA = new PublicKey("EBvSDzxgs5DsjATPhJTdDLcxJcwPDLxCkHwEFTgcb1ov");

function fakePresignConnection(): FakeConnection {
  return new FakeConnection();
}

class FakeConnection implements PresignConnection {
  accounts = new Map<string, AccountInfo<Buffer>>();
  simulateErr: unknown = null;

  seedTokenAccount(address: PublicKey, mint: PublicKey, owner: PublicKey): void {
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0);
    owner.toBuffer().copy(data, 32);
    this.accounts.set(address.toBase58(), {
      data,
      executable: false,
      lamports: 2_000_000,
      owner: TOKEN_PROGRAM_ID,
      rentEpoch: 0n,
    });
  }

  async getMultipleAccountsInfo(publicKeys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
    return publicKeys.map((key) => this.accounts.get(key.toBase58()) ?? null);
  }

  async getAddressLookupTable(): Promise<RpcResponseAndContext<AddressLookupTableAccount | null>> {
    return { context: { slot: 0 }, value: null };
  }

  async simulateTransaction(): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
    return {
      context: { slot: 1 },
      value: {
        err: this.simulateErr,
        logs: [],
        accounts: null,
        unitsConsumed: 0,
        returnData: null,
      },
    };
  }
}

function tokenTransferChecked(input: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
}): Web3Instruction {
  const data = Buffer.alloc(9);
  data[0] = 12;
  data.writeBigUInt64LE(input.amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: input.source, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function systemTransfer(input: {
  from: PublicKey;
  to: PublicKey;
  lamports: bigint;
}): Web3Instruction {
  const data = Buffer.alloc(12);
  data[0] = 2;
  data.writeBigUInt64LE(input.lamports, 1);
  return new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [
      { pubkey: input.from, isSigner: true, isWritable: true },
      { pubkey: input.to, isSigner: false, isWritable: true },
    ],
    data,
  });
}

function buildVersionedTransaction(instructions: Web3Instruction[]): VersionedTransaction {
  const message = MessageV0.compile({
    payerKey: USER_KEY,
    instructions,
    addressLookupTableAccounts: [],
  });
  return new VersionedTransaction(message);
}

function seedStandardSwapAccounts(connection: FakeConnection): void {
  connection.seedTokenAccount(USER_WSOL_ATA, WSOL_MINT, USER_KEY);
  connection.seedTokenAccount(USER_USDC_ATA, USDC_MINT, USER_KEY);
  connection.seedTokenAccount(POOL_WSOL_VAULT, WSOL_MINT, ATTACKER_KEY);
  connection.seedTokenAccount(POOL_USDC_VAULT, USDC_MINT, ATTACKER_KEY);
  connection.seedTokenAccount(ATTACKER_USDC_ATA, USDC_MINT, ATTACKER_KEY);
}

const SWAP_EXPECTATION = {
  inputMint: WSOL_MINT.toBase58(),
  outputMint: USDC_MINT.toBase58(),
  minAmountOutRaw: "9500000",
};

function legitSwapInstructions(): Web3Instruction[] {
  return [
    systemTransfer({ from: USER_KEY, to: USER_WSOL_ATA, lamports: 100_000_000n }),
    tokenTransferChecked({
      source: USER_WSOL_ATA,
      mint: WSOL_MINT,
      destination: POOL_WSOL_VAULT,
      authority: USER_KEY,
      amount: 100_000_000n,
    }),
    tokenTransferChecked({
      source: POOL_USDC_VAULT,
      mint: USDC_MINT,
      destination: USER_USDC_ATA,
      authority: ATTACKER_KEY,
      amount: 10_000_000n,
    }),
  ];
}

describe("verifySwapBeforeSign", () => {
  test("passes a well-formed Jupiter-style swap", async () => {
    const connection = fakePresignConnection();
    seedStandardSwapAccounts(connection);
    const tx = buildVersionedTransaction(legitSwapInstructions());

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.simulated).toBe(true);
  });

  test("blocks a SOL drain to a foreign address", async () => {
    const connection = fakePresignConnection();
    seedStandardSwapAccounts(connection);
    const tx = buildVersionedTransaction([
      ...legitSwapInstructions(),
      systemTransfer({ from: USER_KEY, to: ATTACKER_KEY, lamports: 5_000_000_000n }),
    ]);

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes("SOL transfer") && v.includes("lamports"))
    ).toBe(true);
  });

  test("blocks an output payout to a foreign token account", async () => {
    const connection = fakePresignConnection();
    seedStandardSwapAccounts(connection);
    const tx = buildVersionedTransaction([
      ...legitSwapInstructions(),
      tokenTransferChecked({
        source: POOL_USDC_VAULT,
        mint: USDC_MINT,
        destination: ATTACKER_USDC_ATA,
        authority: ATTACKER_KEY,
        amount: 500_000n,
      }),
    ]);

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("outside the requested swap"))).toBe(true);
  });

  test("blocks selling a token the wallet did not request to sell", async () => {
    const connection = fakePresignConnection();
    connection.seedTokenAccount(USER_WSOL_ATA, WSOL_MINT, USER_KEY);
    connection.seedTokenAccount(USER_USDC_ATA, USDC_MINT, USER_KEY);
    connection.seedTokenAccount(POOL_WSOL_VAULT, WSOL_MINT, ATTACKER_KEY);
    connection.seedTokenAccount(POOL_USDC_VAULT, USDC_MINT, ATTACKER_KEY);
    const attackerOwnedBonk = new PublicKey("FbG5nWnbkBcnmwKoXLS3RpLWE3PGnvknHptEPn2tRDpJ");
    connection.seedTokenAccount(attackerOwnedBonk, BONK_MINT, ATTACKER_KEY);
    const userBonkAta = new PublicKey("G9bxWqbFSzB2nB7TFQtC1mgWxKGBhrCAvbCzGUkPWZQv");
    connection.seedTokenAccount(userBonkAta, BONK_MINT, USER_KEY);

    const tx = buildVersionedTransaction([
      tokenTransferChecked({
        source: USER_WSOL_ATA,
        mint: WSOL_MINT,
        destination: POOL_WSOL_VAULT,
        authority: USER_KEY,
        amount: 100_000_000n,
      }),
      tokenTransferChecked({
        source: POOL_USDC_VAULT,
        mint: USDC_MINT,
        destination: USER_USDC_ATA,
        authority: ATTACKER_KEY,
        amount: 10_000_000n,
      }),
      tokenTransferChecked({
        source: userBonkAta,
        mint: BONK_MINT,
        destination: attackerOwnedBonk,
        authority: USER_KEY,
        amount: 1_000n,
      }),
    ]);

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("wallet pays in token"))).toBe(true);
  });

  test("blocks a payout below the accepted minimum", async () => {
    const connection = fakePresignConnection();
    seedStandardSwapAccounts(connection);
    const instructions = legitSwapInstructions();
    instructions[2] = tokenTransferChecked({
      source: POOL_USDC_VAULT,
      mint: USDC_MINT,
      destination: USER_USDC_ATA,
      authority: ATTACKER_KEY,
      amount: 100_000n,
    });
    const tx = buildVersionedTransaction(instructions);

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("below the accepted minimum"))).toBe(true);
  });

  test("surfaces a failed simulation", async () => {
    const connection = fakePresignConnection();
    seedStandardSwapAccounts(connection);
    connection.simulateErr = { InstructionError: [0, "Custom"] };
    const tx = buildVersionedTransaction(legitSwapInstructions());

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("simulation failed"))).toBe(true);
  });

  test("blocks when the fee payer is not the wallet owner", async () => {
    const connection = fakePresignConnection();
    seedStandardSwapAccounts(connection);
    const message = MessageV0.compile({
      payerKey: ATTACKER_KEY,
      instructions: legitSwapInstructions(),
      addressLookupTableAccounts: [],
    });
    const tx = new VersionedTransaction(message);

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("fee payer"))).toBe(true);
  });

  test("ignores compute budget instructions and tolerates a WSOL close to the wallet", async () => {
    const connection = fakePresignConnection();
    seedStandardSwapAccounts(connection);
    const closeData = Buffer.from([9]);
    const closeInstruction = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: USER_WSOL_ATA, isSigner: false, isWritable: true },
        { pubkey: USER_KEY, isSigner: false, isWritable: true },
        { pubkey: USER_KEY, isSigner: true, isWritable: false },
      ],
      data: closeData,
    });
    const computeInstruction = new TransactionInstruction({
      programId: ComputeBudgetProgram.programId,
      keys: [],
      data: Buffer.from([2, 12, 0, 0, 0, 0, 0, 0, 0]),
    });
    const tx = buildVersionedTransaction([
      ...legitSwapInstructions(),
      closeInstruction,
      computeInstruction,
    ]);

    const result = await verifySwapBeforeSign({
      connection,
      transaction: tx,
      owner: USER_KEY.toBase58(),
      expected: SWAP_EXPECTATION,
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
