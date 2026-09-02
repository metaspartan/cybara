---
name: game-development
description: Route and execute game project work across Unreal Engine, Unity, Godot, Bevy, browser engines, assets, performance, builds, and playtesting. Use when a game request spans systems or the engine is not yet confirmed.
---

# Game development

Use this skill as the entry point for game work that is not already scoped to one specialist workflow.

## Routing

1. Inspect project markers using `../../references/engine-workflows.md`.
2. Load exactly one primary engine skill:
   - Unreal Engine: `../unreal-engine/SKILL.md`
   - Unity: `../unity/SKILL.md`
   - Godot: `../godot/SKILL.md`
   - Bevy: `../bevy/SKILL.md`
   - Phaser, Three.js, React Three Fiber, Babylon.js, or PlayCanvas: `../web-game-development/SKILL.md`
3. Add `../game-asset-pipeline/SKILL.md` when the task changes models, textures, animation, audio, or import settings.
4. Add `../game-ui/SKILL.md` for HUD, menus, input prompts, accessibility, and responsive layout.
5. Add `../sprite-pipeline/SKILL.md` for sprite sheets, atlases, pivots, animation frames, and engine imports.
6. Add `../game-networking/SKILL.md` for authoritative multiplayer, replication, prediction, rollback, lobbies, and network testing.
7. Finish implementation work with `../game-playtesting/SKILL.md`.
8. Use the separate `blender-mcp` skill when a connected Blender workflow is needed.

## Workflow

1. Establish the engine version, target platforms, player verbs, and expected frame rate.
2. Read repository instructions and the existing build and test setup.
3. Separate simulation, presentation, input, UI, persistence, and platform integration.
4. Make the smallest coherent change that follows the project's established architecture.
5. Run engine-native validation before launching the game.
6. Exercise the changed behavior through a representative player flow.
7. Capture visual and performance evidence when those outcomes are in scope.

## Guardrails

- Do not upgrade an engine, renderer, render pipeline, scripting backend, or asset format unless requested.
- Do not edit engine caches, generated project files, imported libraries, or binary assets as source.
- Do not replace a working architecture with a generic template.
- Do not call a game tested when only compilation or a static scene inspection ran.
- Keep credentials, signing material, store keys, and proprietary platform SDK data out of output and logs.

## Verification

Follow the verification ladder in `../../references/engine-workflows.md`, ending with a representative rendered player flow whenever the engine can run in the current environment.

## Completion report

State the engine and version, files changed, checks run, gameplay path exercised, performance evidence collected, and any layer that could not be verified.
