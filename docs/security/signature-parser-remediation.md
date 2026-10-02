# Mobile build signature-parser remediation

## Finding and scope

The additional OSV scan of dev commit `4778f4275dc6694d6095095da1396d0549e566e1` found `GHSA-86w9-cpqp-85rv` / `CVE-2026-85393` in mobile build dependencies. The advisory was reviewed on October 1, 2026, after the earlier dependency checks. Registry release `node-forge@1.4.0` remained the latest version and the advisory listed no patched release.

RSA PKCS#1 v1.5 verification validated the outer DigestInfo element count but allowed unconsumed elements inside its DigestAlgorithm sequence. The mobile dependency is used transitively by Expo code-signing tooling; it is not a newly introduced direct runtime dependency.

## Remediation

`apps/mobile/patches/node-forge@1.4.0.patch` adds the missing nested element-count validation: exactly the algorithm OID and its supported optional parameters are accepted. The change follows the validation logic in the upstream proposed fix, without changing key generation, supported signatures, or unrelated parsing.

Bun applies the patch from the mobile manifest and lockfile on frozen installs. The local security-audit wrapper fails closed if either the exact patch registration or installed validation logic is missing. Only the verified mobile workspace receives the advisory exception; other workspaces remain subject to the original finding.

OSV's version-only scan cannot distinguish patched source from registry version 1.4.0. Its exception therefore records the committed fix and regression evidence and expires December 31, 2026. This is not acceptance of the unpatched vulnerability. Replace the source patch and exception when a verified upstream fixed release becomes available.

## Verification

- Before the patch, the regression accepted all four malformed nested-element signatures and failed its rejection assertion.
- After the patch, all four malformed signatures were rejected. Valid SHA-256 signatures and signatures with supported absent optional parameters were accepted; a wrong-message signature remained rejected.
- The patch-registration audit rejects missing, unpatched, or wrongly registered installations.
- Focused signature and audit tests: 18 passed, zero failures.
- Frozen mobile dependency install passed; all four workspace dependency audits passed.

## Sources

- [Reviewed advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
- [Upstream proposed fix](https://github.com/digitalbazaar/forge/pull/1152)

The original failed security scan is retained in GitHub Actions history rather than erased or rerun as evidence of an unchanged fix.
