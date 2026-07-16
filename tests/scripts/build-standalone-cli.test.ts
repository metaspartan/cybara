import { describe, expect, test } from "bun:test";
import { standaloneCliBuildArgs } from "../../scripts/build-standalone-cli";

describe("standalone CLI build", () => {
  test("keeps architecture-specific ML runtimes external", () => {
    const args = standaloneCliBuildArgs("bun-darwin-x64", "cybara-darwin-x64");

    expect(args).toContain("--target=bun-darwin-x64");
    expect(args).toContain("--outfile=cybara-darwin-x64");
    expect(args).toContain("@huggingface/transformers");
    expect(args).toContain("kokoro-js");
    expect(args).toContain("onnxruntime-node");
    expect(args).toContain("onnxruntime-web");
    expect(args).not.toContain("tiny-secp256k1");
  });
});
