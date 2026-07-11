import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { resolve } from "path";

describe("test storage isolation", () => {
  test("keeps direct Bun test runs outside the real Cybara home", () => {
    const cybaraHome = resolve(process.env.CYBARA_HOME || "");
    const realCybaraHome = resolve(process.env.CYBARA_TEST_REAL_HOME || "", ".cybara");

    expect(process.env.CYBARA_TEST_ISOLATED).toBe("1");
    expect(cybaraHome).not.toBe(realCybaraHome);
    expect(cybaraHome).toStartWith(resolve(tmpdir()));
  });
});
