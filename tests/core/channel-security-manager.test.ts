import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const DRIVER = String.raw`
import {
  ChannelSecurityManager,
  stopPairingCleanup,
  generatePairingCode,
} from "SECURITY_MODULE";

const out: Record<string, unknown> = {};
const m = new ChannelSecurityManager();
const CH = "chan-1";
const SENDER = "user-abc";

m.setConfig(CH, { dm_policy: "pairing", max_pending_pairings: 3, pairing_expiry_minutes: 60 });

const first = m.checkAccess(CH, SENDER, "line");
out.firstReason = first.reason;
out.firstPermitted = first.permitted;
out.firstHasCode = typeof first.code === "string" && first.code.length === 6;

const second = m.checkAccess(CH, SENDER, "line");
out.secondReason = second.reason;
out.sameCode = second.code === first.code;

out.pendingCount = m.getPendingPairings(CH).length;

m.checkAccess(CH, "u2", "line");
m.checkAccess(CH, "u3", "line");
const overflow = m.checkAccess(CH, "u4", "line");
out.overflowReason = overflow.reason;
out.overflowBlocked = overflow.permitted === false;

const verifyBad = m.verifyPairing(CH, "ZZZZZZ");
out.verifyBadSuccess = verifyBad.success;

const verifyGood = m.verifyPairing(CH, first.code!);
out.verifyGoodSuccess = verifyGood.success;
out.verifyGoodSender = verifyGood.senderId;

out.nowAllowed = m.isAllowed(CH, SENDER);
const afterPair = m.checkAccess(CH, SENDER, "line");
out.afterPairReason = afterPair.reason;
out.afterPairPermitted = afterPair.permitted;

out.doubleRedeem = m.verifyPairing(CH, first.code!).success;

const remove = m.removeAllowedSender(CH, SENDER);
out.removed = remove;
out.removedAgain = m.removeAllowedSender(CH, SENDER);
out.allowedAfterRemove = m.isAllowed(CH, SENDER);

const CH2 = "chan-2";
m.setConfig(CH2, { dm_policy: "pairing", pairing_expiry_minutes: -1000 });
const expiredResult = m.checkAccess(CH2, "victim", "line");
out.expiredCreatedReason = expiredResult.reason;
const pendingExpired = m.getPendingPairings(CH2);
out.expiredPendingCount = pendingExpired.length;
const verifyExpired = m.verifyPairing(CH2, expiredResult.code!);
out.verifyExpiredSuccess = verifyExpired.success;

m.setConfig(CH2, { pairing_expiry_minutes: -60 });
m.checkAccess(CH2, "victim2", "line");
const cleaned = m.cleanupExpired();
out.cleanupRan = typeof cleaned === "number";

const CH3 = "chan-grp";
m.setConfig(CH3, { group_policy: "owner_only", group_owner_sender_id: "owner-1" });
out.groupOwnerAllowed = m.checkAccess(CH3, "owner-1", "line", undefined, { isGroup: true }).permitted;
out.groupStrangerBlocked =
  m.checkAccess(CH3, "stranger", "line", undefined, { isGroup: true }).permitted === false;

m.setConfig(CH3, { group_policy: "open" });
out.groupOpenAllowed = m.checkAccess(CH3, "anyone", "line", undefined, { isGroup: true }).permitted;

m.setConfig(CH3, { group_policy: "disabled" });
out.groupDisabledBlocked =
  m.checkAccess(CH3, "anyone", "line", undefined, { isGroup: true }).permitted === false;

const CH4 = "chan-dm";
m.setConfig(CH4, { dm_policy: "disabled" });
out.dmDisabledBlocked = m.checkAccess(CH4, "x", "line").permitted === false;
m.setConfig(CH4, { dm_policy: "open" });
out.dmOpenAllowed = m.checkAccess(CH4, "x", "line").permitted;
m.setConfig(CH4, { dm_policy: "allowlist" });
out.dmAllowlistBlocked = m.checkAccess(CH4, "x", "line").permitted === false;
m.addAllowedSender(CH4, "listed");
out.dmAllowlistAllowsListed = m.checkAccess(CH4, "listed", "line").permitted;

const CH5 = "chan-wild";
m.setConfig(CH5, { dm_policy: "allowlist" });
m.addAllowedSender(CH5, "*");
out.wildcardAllowsAnyone = m.checkAccess(CH5, "random-person", "line").permitted;

out.rejectMissing = m.rejectPairing(CH, "no-such-id");

stopPairingCleanup();

const before = process.getActiveResourcesInfo?.() ?? [];
out.activeTimersAfterStop = before.filter((r) => r === "Timeout").length;

process.stdout.write(JSON.stringify(out));
`;

interface DriverOut {
  firstReason: string;
  firstPermitted: boolean;
  firstHasCode: boolean;
  secondReason: string;
  sameCode: boolean;
  pendingCount: number;
  overflowReason: string;
  overflowBlocked: boolean;
  verifyBadSuccess: boolean;
  verifyGoodSuccess: boolean;
  verifyGoodSender: string;
  nowAllowed: boolean;
  afterPairReason: string;
  afterPairPermitted: boolean;
  doubleRedeem: boolean;
  removed: boolean;
  removedAgain: boolean;
  allowedAfterRemove: boolean;
  expiredCreatedReason: string;
  expiredPendingCount: number;
  verifyExpiredSuccess: boolean;
  cleanupRan: boolean;
  groupOwnerAllowed: boolean;
  groupStrangerBlocked: boolean;
  groupOpenAllowed: boolean;
  groupDisabledBlocked: boolean;
  dmDisabledBlocked: boolean;
  dmOpenAllowed: boolean;
  dmAllowlistBlocked: boolean;
  dmAllowlistAllowsListed: boolean;
  wildcardAllowsAnyone: boolean;
  rejectMissing: boolean;
  activeTimersAfterStop: number;
}

function runDriver(): DriverOut {
  const tempHome = mkdtempSync(join(tmpdir(), "cybara-secmgr-"));
  const securityModule = join(process.cwd(), "src", "core", "channels", "security.ts");
  const scriptPath = join(tempHome, "driver.ts");
  writeFileSync(scriptPath, DRIVER.replace("SECURITY_MODULE", securityModule.replace(/\\/g, "/")));
  try {
    const proc = Bun.spawnSync(["bun", "run", scriptPath], {
      env: { ...process.env, CYBARA_HOME: tempHome },
      cwd: process.cwd(),
    });
    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    if (proc.exitCode !== 0) {
      throw new Error(`driver exited ${proc.exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    const jsonStart = stdout.lastIndexOf("{");
    return JSON.parse(stdout.slice(jsonStart)) as DriverOut;
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
}

describe("ChannelSecurityManager lifecycle (isolated temp CYBARA_HOME)", () => {
  const r = runDriver();

  test("pairing DM: first contact mints a new pairing code", () => {
    expect(r.firstReason).toBe("new_pairing");
    expect(r.firstPermitted).toBe(false);
    expect(r.firstHasCode).toBe(true);
  });

  test("repeat contact returns the same pending code, not a new one", () => {
    expect(r.secondReason).toBe("pending_pairing");
    expect(r.sameCode).toBe(true);
    expect(r.pendingCount).toBe(1);
  });

  test("pending pairings cap blocks further requests", () => {
    expect(r.overflowReason).toBe("blocked");
    expect(r.overflowBlocked).toBe(true);
  });

  test("verifyPairing rejects an unknown code, accepts the real one", () => {
    expect(r.verifyBadSuccess).toBe(false);
    expect(r.verifyGoodSuccess).toBe(true);
    expect(r.verifyGoodSender).toBe("user-abc");
  });

  test("approved sender becomes allowed and passes checkAccess", () => {
    expect(r.nowAllowed).toBe(true);
    expect(r.afterPairReason).toBe("allowed");
    expect(r.afterPairPermitted).toBe(true);
  });

  test("a code cannot be redeemed twice", () => {
    expect(r.doubleRedeem).toBe(false);
  });

  test("removeAllowedSender revokes access and is idempotent", () => {
    expect(r.removed).toBe(true);
    expect(r.removedAgain).toBe(false);
    expect(r.allowedAfterRemove).toBe(false);
  });

  test("expired pairings are not returned as pending and cannot be verified", () => {
    expect(r.expiredCreatedReason).toBe("new_pairing");
    expect(r.expiredPendingCount).toBe(0);
    expect(r.verifyExpiredSuccess).toBe(false);
  });

  test("cleanupExpired runs and returns a count", () => {
    expect(r.cleanupRan).toBe(true);
  });

  test("group owner_only policy: owner allowed, stranger blocked", () => {
    expect(r.groupOwnerAllowed).toBe(true);
    expect(r.groupStrangerBlocked).toBe(true);
  });

  test("group open allows anyone; disabled blocks everyone", () => {
    expect(r.groupOpenAllowed).toBe(true);
    expect(r.groupDisabledBlocked).toBe(true);
  });

  test("DM policies: disabled/open/allowlist behave as specified", () => {
    expect(r.dmDisabledBlocked).toBe(true);
    expect(r.dmOpenAllowed).toBe(true);
    expect(r.dmAllowlistBlocked).toBe(true);
    expect(r.dmAllowlistAllowsListed).toBe(true);
  });

  test("wildcard allowed sender does not bypass the allowlist", () => {
    expect(r.wildcardAllowsAnyone).toBe(false);
  });

  test("rejectPairing on a missing id returns false", () => {
    expect(r.rejectMissing).toBe(false);
  });

  test("stopPairingCleanup leaves no active Timeout keeping the process alive", () => {
    expect(r.activeTimersAfterStop).toBe(0);
  });
});
