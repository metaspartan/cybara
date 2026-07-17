import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GatewayLogFile, installGatewayLogCapture } from "../../src/core/runtime/gateway-log-file";

describe("gateway process log", () => {
  test("can be disabled when another process owns stdout persistence", () => {
    const original = console.log;
    const restore = installGatewayLogCapture({
      environment: { CYBARA_GATEWAY_LOG_CAPTURE: "0" },
    });
    expect(console.log).toBe(original);
    restore();
  });

  test("writes redacted JSON records and keeps bounded rotations", () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-gateway-log-"));
    const writer = new GatewayLogFile({
      directory,
      maxFileBytes: 1024,
      retainedFiles: 3,
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });

    try {
      writer.write("error", ["Authorization: Bearer abc.def.ghi", "x".repeat(700)]);
      writer.write("info", ["gateway ready", "y".repeat(700)]);
      writer.write("warn", ["gateway pressure", "z".repeat(700)]);
      writer.close();

      expect(existsSync(join(directory, "gateway.out.log"))).toBe(true);
      expect(existsSync(join(directory, "gateway.out.1.log"))).toBe(true);
      expect(existsSync(join(directory, "gateway.out.2.log"))).toBe(true);
      expect(existsSync(join(directory, "gateway.out.3.log"))).toBe(false);

      const records = [0, 1, 2]
        .map((index) =>
          readFileSync(
            join(directory, index === 0 ? "gateway.out.log" : `gateway.out.${index}.log`),
            "utf8"
          )
        )
        .join("\n");
      expect(records).toContain('"source":"gateway"');
      expect(records).toContain("[REDACTED]");
      expect(records).not.toContain("abc.def.ghi");
    } finally {
      writer.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("feeds gateway records into the combined log reader", () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-gateway-reader-"));
    const expression = `
      const { GatewayLogFile } = await import(${JSON.stringify(
        join(process.cwd(), "src/core/runtime/gateway-log-file.ts")
      )});
      const writer = new GatewayLogFile();
      writer.write("warn", ["gateway restart test"]);
      writer.close();
      const { getCliLogs } = await import(${JSON.stringify(
        join(process.cwd(), "src/api/queries.ts")
      )});
      process.stdout.write(JSON.stringify(getCliLogs(10)));
    `;

    try {
      const result = Bun.spawnSync([process.execPath, "-e", expression], {
        cwd: process.cwd(),
        env: { ...process.env, CYBARA_HOME: directory },
      });
      expect(result.exitCode).toBe(0);
      const logs = JSON.parse(result.stdout.toString()) as Array<{
        source: string;
        message: string;
      }>;
      expect(logs).toContainEqual(
        expect.objectContaining({ source: "gateway", message: "gateway restart test" })
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
