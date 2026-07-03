import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMintDecimals,
} from "../../src/core/solana-token";

describe("local Solana SPL token helpers", () => {
  test("exports the canonical token program ids", () => {
    expect(TOKEN_PROGRAM_ID.toBase58()).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(TOKEN_2022_PROGRAM_ID.toBase58()).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()).toBe(
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    );
  });

  test("derives associated token accounts and builds create instructions", () => {
    const owner = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
    const payer = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
    const mint = new PublicKey("So11111111111111111111111111111111111111112");
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const instruction = createAssociatedTokenAccountInstruction(payer, ata, owner, mint);

    expect(ata.toBase58()).toBe("7azMPufyz8EfKAif9WajHfBbFj5ic8C8rLfaTBfKdN1A");
    expect(instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(instruction.data.length).toBe(0);
    expect(instruction.keys.map((key) => key.pubkey.toBase58())).toEqual([
      payer.toBase58(),
      ata.toBase58(),
      owner.toBase58(),
      mint.toBase58(),
      SystemProgram.programId.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
    ]);
    expect(instruction.keys.map((key) => [key.isSigner, key.isWritable])).toEqual([
      [true, true],
      [false, true],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
    ]);
  });

  test("builds transfer checked instruction data without bigint-buffer", () => {
    const source = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
    const mint = new PublicKey("So11111111111111111111111111111111111111112");
    const destination = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
    const owner = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
    const instruction = createTransferCheckedInstruction(source, mint, destination, owner, 258n, 6);

    expect(instruction.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(instruction.data.toString("hex")).toBe("0c020100000000000006");
    expect(instruction.keys.map((key) => key.pubkey.toBase58())).toEqual([
      source.toBase58(),
      mint.toBase58(),
      destination.toBase58(),
      owner.toBase58(),
    ]);
    expect(instruction.keys.map((key) => [key.isSigner, key.isWritable])).toEqual([
      [false, true],
      [false, false],
      [false, true],
      [true, false],
    ]);
  });

  test("reads mint decimals from canonical mint layout", async () => {
    const mint = new PublicKey("So11111111111111111111111111111111111111112");
    const data = Buffer.alloc(82);
    data[44] = 9;
    const connection = {
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID, data }),
    };

    await expect(getMintDecimals(connection as never, mint, "confirmed")).resolves.toBe(9);
  });

  test("rejects unsupported mint owners and out-of-range transfer amounts", async () => {
    const mint = new PublicKey("So11111111111111111111111111111111111111112");
    const connection = {
      getAccountInfo: async () => ({ owner: SystemProgram.programId, data: Buffer.alloc(82) }),
    };

    await expect(getMintDecimals(connection as never, mint, "confirmed")).rejects.toThrow(
      "unsupported owner"
    );
    expect(() => createTransferCheckedInstruction(mint, mint, mint, mint, 1n << 64n, 6)).toThrow(
      "outside u64 range"
    );
  });
});
