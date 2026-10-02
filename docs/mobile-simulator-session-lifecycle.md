# Simulator session lifetime and release quality fixes

## Session-owned simulators

Simulators started by an agent are leased to its chat session. Finalizing a turn after success, interruption or failure releases the lease before queued work starts. Deleting a session releases any remaining leases. A simulator shared by multiple sessions is stopped only after the last lease is released.

Pre-existing booted devices are not owned by Cybara and are not automatically stopped. A simulator explicitly started from the user-facing simulator controls is retained across chat completion; explicit stop and gateway shutdown still stop a device Cybara booted. An explicit stop request also remains capable of stopping a pre-existing device.

Android emulator process handles are retained. Startup failure, cancellation and final cleanup reap the launched emulator process tree. Temporary boot-time ADB failures are retried only inside the existing bounded boot deadline; interruption cancels the current command. iOS boot and boot-status commands receive cancellation signals, and failed boots attempt shutdown. Device caches and frame caches are invalidated after cleanup. Cleanup failures propagate and ownership is retained for retry rather than silently discarded.

Supported graceful gateway termination runs the same owned-device cleanup. Forced process termination, host power loss and simulators started by older gateway versions are not retroactively guaranteed to be cleaned up; unrelated devices are never indiscriminately killed.

## Confirmed release failures — October 2, 2026

- Main CI run `36945436956` failed its mobile security audit. The wrapper computed the verified patched signature-parser advisory exception but passed the original workspace policy into both audit engines. The fixed code passes the checked policy to Bun and the OSV fallback. Findings on stdout are now included in failure messages; empty nonzero audit output still fails closed.
- Release `v1.0.2481`, run `36945471764`, failed a real browser integration test because its quality gate did not install the pinned Chromium browser. The release workflow now installs Chromium with system dependencies before `bun run check:ci`, matching regular CI. No tests or gates are skipped to work around this failure.

## Verification

Lifecycle tests cover zero/one/two leases, simultaneous starts, pre-existing devices, manual retention, discovery races, aborted starts, shared readers, idempotent release, explicit stop, and retry after shutdown failure. Audit regressions assert the verified exception reaches the real runner, other workspaces do not inherit it, and stdout findings remain visible. The release workflow regression requires Chromium installation before the quality checks without `continue-on-error`.

A real Android `Pixel_9_Pro` was booted and captured at 1280×2856. Its screenshot showed a wallpaper/loading frame, so it is capture evidence rather than proof of a usable home screen. The native check confirmed that one released session did not stop a second session's device, the last release stopped it, and cancelled startup left zero running devices. A native chat turn then executed the actual `mobile_simulator` start tool, observed the booted device, and returned only after shutdown; zero running devices remained. That chat used a deterministic local provider fixture, not a live-model accuracy benchmark.

Native iOS execution was not available on the Windows host. Platform-independent lifecycle tests exercise iOS ownership and cancellation semantics, but do not substitute for an Xcode-native smoke test. The installed application and live gateway were not restarted for these checks.
