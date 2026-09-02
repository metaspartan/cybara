---
name: web-game-development
description: Implement and optimize browser games using Phaser, Three.js, React Three Fiber, Babylon.js, or PlayCanvas with responsive input, asset loading, rendering, and browser playtests. Use for JavaScript or TypeScript game projects.
---

# Web game development

## Select the existing engine

Read `package.json`, source imports, renderer initialization, and asset loaders before editing. Preserve the chosen engine unless the user requests a migration.

- Phaser: scene-driven 2D games, sprites, tilemaps, cameras, and arcade or matter physics.
- Three.js: imperative 3D scene, camera, renderer, loaders, and render-loop control.
- React Three Fiber: React-owned composition around Three.js with explicit per-frame boundaries.
- Babylon.js: engine-managed 3D scenes, loaders, physics, GUI, and WebGPU or WebGL paths.
- PlayCanvas: component and entity workflows using the project's selected editor or engine package.

## Implementation rules

- Use Bun for dependency and script commands.
- Keep simulation state separate from rendering objects and DOM UI.
- Map keyboard, pointer, touch, and controller input into explicit game actions.
- Handle resize, device pixel ratio, pause, visibility changes, audio unlock, and WebGL context loss.
- Keep text-heavy HUD and menus accessible and responsive.
- Bound texture resolution, geometry, particles, post-processing, and retained resources.
- Dispose GPU resources and listeners when scenes or components unload.

## Verification

1. Run the repository's typecheck, lint, and unit tests.
2. Build the production bundle and inspect asset warnings and output size.
3. Launch the real app in a browser rather than testing a detached mock.
4. Exercise boot, loading, primary controls, pause and resume, scene transitions, failure and restart, and responsive resize.
5. Capture screenshots from representative gameplay states.
6. Check console errors, failed network requests, frame pacing, memory growth, and WebGL warnings.
7. Repeat touch and safe-area checks when mobile browsers are supported.

## Completion criteria

Report the engine, browser and viewport tested, player path, production build result, console state, screenshots, and measured performance limitations.
