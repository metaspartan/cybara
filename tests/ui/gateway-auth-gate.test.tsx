import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dirname, "..", "..");

describe("gateway authentication gate", () => {
  test("does not mount the application before gateway access is verified", () => {
    const app = readFileSync(join(ROOT_DIR, "ui", "src", "App.tsx"), "utf8");
    const gate = readFileSync(
      join(ROOT_DIR, "ui", "src", "components", "GatewayAuthGate.tsx"),
      "utf8"
    );

    expect(app).toContain("<GatewayAuthGate>");
    expect(gate).toContain('if (access.status === "ready" && !checking) return <>{children}</>');
    expect(gate).toContain("Connecting to Cybara");
  });
});
