---
name: bevy
description: Build, test, debug, and optimize Rust games and tools using the Bevy engine, ECS scheduling, assets, rendering, and platform features. Use when `Cargo.toml` selects Bevy.
---

# Bevy

## Inspect first

1. Read the workspace `Cargo.toml`, lockfile, Bevy version, feature flags, profiles, and target configuration.
2. Inspect plugins, states, schedules, systems, components, resources, events, assets, examples, and tests near the behavior.
3. Identify fixed-timestep, startup, update, rendering, and extraction boundaries.
4. Reuse the repository's configured Rust toolchain and task commands.

## Implementation rules

- Keep systems focused and make ordering or ambiguity explicit.
- Use events, resources, states, and components according to data ownership rather than as global shortcuts.
- Avoid conflicting mutable queries and broad world access when narrower system parameters work.
- Keep deterministic simulation separate from frame-rate-dependent presentation.
- Preserve asset handles and loading states; do not block the main schedule on synchronous asset work.
- Do not change Bevy versions or default features as part of an unrelated fix.

## Verification

1. Format with the configured Rust formatter.
2. Run focused tests, then workspace tests.
3. Run the repository's lint configuration without weakening it.
4. Build the affected examples, binaries, and target profiles.
5. Launch the game and exercise the changed state transitions and player inputs.
6. Inspect panic output, asset diagnostics, schedule ambiguity, render warnings, and platform errors.

## Performance

Measure schedule time, system parallelism, entity churn, asset memory, render extraction, draw calls, and frame pacing in representative gameplay. Prefer fewer structural changes and reusable buffers in hot systems, then confirm the result with the same capture.

## Completion criteria

Report Bevy and Rust versions, features and target built, tests and lints run, gameplay flow exercised, and any GPU or platform limitation.
