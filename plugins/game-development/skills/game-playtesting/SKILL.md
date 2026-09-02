---
name: game-playtesting
description: Test a game end to end like a player across boot, controls, gameplay loops, UI, save state, failure recovery, rendering, audio, performance, and platform behavior. Use after game implementation or for regression investigation.
---

# Game playtesting

## Establish the test contract

Identify the engine, build, target platform, expected controls, core loop, success and failure states, save behavior, and performance target. Use a development or instrumented build when possible, then repeat critical checks in a shipping-shaped build.

## Verification journey

1. Start from a clean launch and observe loading, first frame, and actionable state.
2. Exercise every primary input and confirm visible and audible feedback.
3. Complete one representative gameplay loop.
4. Trigger damage, failure, pause, resume, restart, scene transition, and quit paths that apply.
5. Save, reload, and verify state boundaries.
6. Resize, background, restore, disconnect, or change input devices where supported.
7. Repeat the riskiest path after a warm reload to catch leaked state.

## Visual and interaction checks

- HUD readability and playfield obstruction
- Camera bounds, clipping, jitter, and reset behavior
- Animation transitions and collision alignment
- Loading placeholders and asset pop-in
- Keyboard, pointer, controller, and touch focus ownership
- Menus that pause or release gameplay input correctly
- Text scaling, localization expansion, safe areas, and color contrast
- Screenshot consistency at important checkpoints

## Performance checks

Capture frame time rather than only average frames per second. Watch CPU, GPU, memory, allocations, asset streaming, shader compilation, loading, network stalls, and long-session growth. Reproduce spikes at the same gameplay checkpoint before diagnosing them.

## Findings

Report issues by severity with exact build, platform, starting state, steps, actual result, expected result, frequency, evidence, and likely owning subsystem. Separate confirmed defects from observations that need a profiler or target device.
