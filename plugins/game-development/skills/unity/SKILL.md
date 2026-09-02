---
name: unity
description: Build, debug, test, profile, and package Unity projects while preserving scenes, prefabs, metadata, assembly boundaries, and render-pipeline settings. Use for projects with `Assets` and `ProjectSettings`.
---

# Unity

## Inspect first

1. Read `ProjectSettings/ProjectVersion.txt`, `Packages/manifest.json`, and relevant assembly definitions.
2. Locate the owning scripts, scenes, prefabs, ScriptableObjects, input actions, tests, and build scripts.
3. Determine the active render pipeline and scripting backend without changing either.
4. Discover the matching Unity Editor executable through the project or Unity Hub installation.

Preserve `.meta` files and GUID references. Avoid bulk text edits to scenes, prefabs, animation clips, and serialized assets when an editor-aware path is available.

## Implementation rules

- Keep domain logic testable outside `MonoBehaviour` where practical.
- Keep frame-rate-independent simulation in the correct update loop.
- Preserve serialization compatibility when renaming fields or types.
- Respect assembly definition boundaries and package versions.
- Avoid repeated allocations, scene-wide searches, and unnecessary component lookup in hot paths.
- Do not trigger an automatic project or package upgrade unless requested.

## Verification

Use existing project scripts first. For unattended validation, resolve the actual editor binary and use batch mode with explicit paths and logs.

1. Run EditMode tests for pure and editor-owned behavior.
2. Run PlayMode tests for scene, lifecycle, physics, and integration behavior.
3. Use `-batchmode -projectPath <project> -runTests -testPlatform <platform> -testResults <xml> -logFile <log> -quit` only with the project's supported Unity Test Framework setup.
4. Run the established build method or build profile.
5. Launch a player build and exercise the changed flow.
6. Inspect editor and player logs rather than relying only on exit code.

## Performance

Profile a representative scene on the target device. Separate main thread, render thread, jobs, garbage collection, draw calls, overdraw, shader variants, asset loading, and memory. Confirm optimizations in a development player rather than only in the editor.

## Completion criteria

Report Unity version, test platforms, result files, build target, player flow, profiler capture scope, and any scene or device verification that remains.
