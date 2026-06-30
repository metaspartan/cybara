import { describe, expect, test } from "bun:test";

import {
  parseDarwinSwapUsage,
  parseDarwinVmStatMemory,
  parseLinuxMeminfoSwap,
} from "../../src/core/system-monitor";

describe("system monitor", () => {
  test("reports macOS memory used without counting reclaimable inactive cache", () => {
    const totalBytes = 24 * 1024 * 1024 * 1024;
    const snapshot = parseDarwinVmStatMemory(
      `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                5025.
Pages active:                            330776.
Pages inactive:                          327147.
Pages speculative:                         2859.
Pages wired down:                        241665.
Pages purgeable:                          12040.
Pages stored in compressor:             1378255.
Pages occupied by compressor:            629752.
File-backed pages:                       235779.
Anonymous pages:                         425003.
`,
      totalBytes
    );

    const expectedUsedBytes = (330776 + 241665 + 629752) * 16384;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedBytes).toBe(expectedUsedBytes);
    expect(snapshot?.freeBytes).toBe(totalBytes - expectedUsedBytes);
    expect(snapshot?.usedPct).toBe(76.4);
  });

  test("rejects malformed macOS vm_stat output", () => {
    expect(parseDarwinVmStatMemory("Mach Virtual Memory Statistics")).toBeNull();
  });

  test("parses macOS swap usage from sysctl", () => {
    const swap = parseDarwinSwapUsage(
      "vm.swapusage: total = 4096.00M  used = 3125.94M  free = 970.06M  (encrypted)"
    );

    expect(swap).not.toBeNull();
    expect(swap?.totalBytes).toBe(4 * 1024 * 1024 * 1024);
    expect(swap?.usedBytes).toBe(Math.round(3125.94 * 1024 * 1024));
    expect(swap?.freeBytes).toBe(swap!.totalBytes - swap!.usedBytes);
    expect(swap?.usedPct).toBe(76.3);
  });

  test("parses Linux swap usage from meminfo", () => {
    const swap = parseLinuxMeminfoSwap(`MemTotal:       16384256 kB
MemFree:         1234567 kB
SwapTotal:       2097152 kB
SwapFree:         524288 kB
`);

    expect(swap).toEqual({
      totalBytes: 2097152 * 1024,
      freeBytes: 524288 * 1024,
      usedBytes: (2097152 - 524288) * 1024,
      usedPct: 75,
    });
  });
});
