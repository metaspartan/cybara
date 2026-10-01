import { expect, test } from "bun:test";
import { join } from "node:path";

interface SignatureProbe {
  valid: boolean;
  optional_parameters: boolean;
  wrong_message: boolean;
  malformed_results: boolean[];
}

const probe = String.raw`
import forge from "./apps/mobile/node_modules/node-forge/lib/index.js";
const keys = forge.pki.rsa.generateKeyPair({bits:1024,e:3});
const hash = forge.md.sha256.create().update("signature-parser-regression");
const digest = hash.digest().getBytes();
const A = forge.asn1;
const element = (type,constructed,value) => A.create(A.Class.UNIVERSAL,type,constructed,value);
const oid = () => element(A.Type.OID,false,A.oidToDer(forge.pki.oids.sha256).getBytes());
const parameters = () => element(A.Type.NULL,false,"");
const extra = () => element(A.Type.OCTETSTRING,false,"unexpected");
const signDigestInfo = children => {
  const info = element(A.Type.SEQUENCE,true,[element(A.Type.SEQUENCE,true,children),element(A.Type.OCTETSTRING,false,digest)]);
  return keys.privateKey.sign(A.toDer(info).getBytes(),"NONE");
};
const verify = signature => {try{return keys.publicKey.verify(digest,signature);}catch{return false;}};
const valid = verify(keys.privateKey.sign(hash));
const optional_parameters = verify(signDigestInfo([oid()]));
const wrong_message = keys.publicKey.verify(forge.md.sha256.create().update("wrong-message").digest().getBytes(),keys.privateKey.sign(hash));
const malformed_results = [[oid(),parameters(),extra()],[oid(),parameters(),parameters()],[oid(),extra()],[oid(),parameters(),extra(),extra()]].map(children=>verify(signDigestInfo(children)));
console.log(JSON.stringify({valid,optional_parameters,wrong_message,malformed_results}));
`;

test("signature verification rejects unconsumed nested algorithm elements but accepts supported signatures", () => {
  const result = Bun.spawnSync([process.execPath, "--eval", probe], {
    cwd: join(import.meta.dir, "..", ".."),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout.toString()) as SignatureProbe;
  expect(parsed.valid).toBe(true);
  expect(parsed.optional_parameters).toBe(true);
  expect(parsed.wrong_message).toBe(false);
  expect(parsed.malformed_results).toEqual([false, false, false, false]);
});

test("mobile signature-parser patch is pinned to the installed dependency", async () => {
  const manifest = (await Bun.file(
    join(import.meta.dir, "../../apps/mobile/package.json")
  ).json()) as {
    patchedDependencies?: Record<string, string>;
  };
  expect(manifest.patchedDependencies?.["node-forge@1.4.0"]).toBe("patches/node-forge@1.4.0.patch");
  const source = await Bun.file(
    join(import.meta.dir, "../../apps/mobile/node_modules/node-forge/lib/rsa.js")
  ).text();
  expect(source).toContain("obj.value[0].value.length");
});
