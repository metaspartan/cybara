---
name: sprite-pipeline
description: Create, normalize, pack, import, and validate production sprite animations, atlases, pivots, collision guides, and pixel-art scaling across 2D game engines.
---

# Sprite pipeline

## Establish the asset contract

Identify target resolution, pixels per unit, palette, frame dimensions, frame rate, facing directions, pivot, baseline, transparency, atlas format, naming, collision expectations, filtering, and engine importer settings.

## Production workflow

1. Start from an approved in-game reference frame or style sheet.
2. Define the exact animation list, frame count, timing, loop mode, and event frames.
3. Produce one coherent animation strip at a time to limit silhouette and scale drift.
4. Normalize every frame to one canvas, shared scale, pivot, and baseline.
5. Remove accidental edge pixels, matte colors, duplicate frames, and transparency artifacts.
6. Pack frames with deterministic names and atlas metadata accepted by the project.
7. Preserve editable source art separately from generated atlases and engine imports.

Do not create frames independently when temporal consistency matters. Do not resample pixel art with smoothing. Do not overwrite approved source frames during normalization.

## Engine integration

- Match filtering and compression to pixel art or painted art intentionally.
- Keep animation event timing separate from render-only frame changes.
- Verify pivots, root movement, sorting, collision, and attachment points in the game scene.
- Reuse atlases where it reduces state changes without exceeding target texture limits.
- Keep generated atlas output reproducible from source frames and configuration.

## Verification

1. Render an atlas or contact-sheet preview before import.
2. Inspect every animation at native scale and representative gameplay scale.
3. Play transitions forward, looped, interrupted, and reversed where supported.
4. Verify no baseline jump, scale drift, edge bleeding, missing frame, or collision mismatch.
5. Test the imported animation in a real scene with camera movement and target filtering.
6. Measure atlas dimensions, memory, draw calls, and build-size impact.

## Completion criteria

Report source and atlas paths, dimensions, frame counts, pivots, importer settings, animations exercised, visual evidence, and any source-art decision awaiting approval.
