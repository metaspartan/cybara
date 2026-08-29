import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type Commitment,
} from "@solana/web3.js";

const MINT_ACCOUNT_SIZE = 82;
const MINT_DECIMALS_OFFSET = 44;
const TRANSFER_CHECKED_INSTRUCTION = 12;
const U64_MAX = (1n << 64n) - 1n;

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export async function getMintDecimals(
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment
): Promise<number> {
  return (await getMintDetails(connection, address, commitment)).decimals;
}

export async function getMintDetails(
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment
): Promise<{ decimals: number; programId: PublicKey }> {
  const info = await connection.getAccountInfo(address, commitment);
  if (!info) {
    throw new Error("SPL token mint account not found");
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("SPL token mint account has an unsupported owner");
  }
  if (info.data.length < MINT_ACCOUNT_SIZE) {
    throw new Error("Invalid SPL token mint account");
  }
  return { decimals: info.data[MINT_DECIMALS_OFFSET], programId: info.owner };
}

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new Error("SPL token owner is off curve");
  }

  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  );

  return address;
}

export function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
    programId: associatedTokenProgramId,
    data: Buffer.alloc(0),
  });
}

export function createTransferCheckedInstruction(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
  programId = TOKEN_PROGRAM_ID
): TransactionInstruction {
  if (amount < 0n || amount > U64_MAX) {
    throw new Error("SPL token transfer amount is outside u64 range");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("SPL token decimals must be a u8 integer");
  }

  const data = Buffer.alloc(10);
  data[0] = TRANSFER_CHECKED_INSTRUCTION;
  data.writeBigUInt64LE(amount, 1);
  data[9] = decimals;

  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId,
    data,
  });
}
