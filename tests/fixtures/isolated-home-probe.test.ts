import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { resolve } from "path";

test("test process starts with an isolated Cybara home", () => {
  expect(process.env.CYBARA_TEST_ISOLATED).toBe("1");
  expect(resolve(process.env.CYBARA_HOME || "")).toStartWith(resolve(tmpdir()));
  expect(resolve(process.env.CYBARA_HOME || "")).not.toStartWith(
    resolve(process.env.CYBARA_TEST_REAL_HOME || "", ".cybara")
  );
});
