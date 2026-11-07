# Mobile build signature-parser remediation

## Status: resolved upstream

`GHSA-86w9-cpqp-85rv` / `CVE-2026-85393` affected `node-forge@1.4.0`, which the mobile build pulls in transitively through Expo code-signing tooling. RSA PKCS#1 v1.5 verification validated the outer DigestInfo element count but allowed unconsumed elements inside its DigestAlgorithm sequence.

The mobile workspace now overrides `node-forge` to `1.4.3`, which rejects those signatures natively. The local source patch, its audit gate, and the advisory exception have all been removed.

## History

On October 1, 2026 no fixed release existed, so `apps/mobile/patches/node-forge@1.4.0.patch` added the missing nested element-count validation and the audit wrapper failed closed unless that patch was verifiably installed. That interim control was removed on November 5, 2026 once a fixed release was available.

## Verification

- OSV reports no advisories for `node-forge@1.4.3`; `node-forge@1.4.0` reports twelve.
- The regression in `tests/runtime/signature-parser-patch.test.ts` still runs against the installed library. Against an unpatched `1.4.0` install all four malformed nested-element signatures are accepted; against `1.4.3` all four are rejected, valid SHA-256 signatures and signatures with supported absent optional parameters are accepted, and a wrong-message signature is rejected.
- The same test asserts that the mobile manifest carries no `node-forge` patch and that the installed version is at least `1.4.3`, so a downgrade fails the suite.

## Sources

- [Reviewed advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
- [Upstream fix](https://github.com/digitalbazaar/forge/pull/1152)
