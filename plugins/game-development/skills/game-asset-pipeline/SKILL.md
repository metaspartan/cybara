---
name: game-asset-pipeline
description: Prepare, import, validate, and optimize game models, textures, materials, rigs, animation, audio, collision, and level assets across engines. Use when asset quality, compatibility, memory, or build size is in scope.
---

# Game asset pipeline

## Inspect the contract

Identify the source format, source-control policy, engine import settings, runtime format, units, axes, pivots, naming, material model, texture budgets, animation conventions, collision strategy, and target platforms.

Use the separate `blender-mcp` skill when Blender is connected and source scene edits are required.

## Pipeline rules

- Preserve editable source assets separately from optimized runtime output.
- Keep units, orientation, pivots, skeleton naming, and animation root motion consistent.
- Reuse materials and texture sets where practical.
- Choose texture compression and resolution for the target platform and visible screen size.
- Define collision proxies and levels of detail intentionally.
- Keep importer settings reproducible and committed when the engine supports that.
- Avoid lossy conversion chains and repeated re-encoding.
- Do not text-edit binary asset files.

## Verification

1. Validate the source asset and export logs.
2. Reimport through the engine's normal path from a clean state.
3. Check missing references, scale, pivot, normals, tangents, UVs, materials, rig, animation, collision, and bounds.
4. Inspect the asset in representative lighting and gameplay distance.
5. Measure runtime memory, load time, draw calls, geometry, texture residency, and build-size impact.
6. Exercise a packaged or exported build because editor previews can hide runtime import differences.

## Completion criteria

Report source and runtime formats, importer changes, validation scene, target platform, visual evidence, before and after size or memory, and any destructive source conversion that was intentionally avoided.
