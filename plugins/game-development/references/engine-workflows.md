# Engine workflow reference

## Project detection

| Engine | Strong project markers | Common source roots |
| --- | --- | --- |
| Unreal Engine | One `.uproject` file | `Source`, `Plugins`, `Config`, `Content` |
| Unity | `Assets` and `ProjectSettings/ProjectVersion.txt` | `Assets`, `Packages`, `ProjectSettings` |
| Godot | `project.godot` | `addons`, `scenes`, `scripts`, `tests` |
| Bevy | `Cargo.toml` with a Bevy dependency | `src`, `assets`, `examples`, `tests` |
| Web engine | `package.json` with Phaser, Three.js, React Three Fiber, Babylon.js, or PlayCanvas | `src`, `public`, `assets`, `tests` |

Use project markers to select a workflow. Do not infer an engine from a single file extension when stronger markers are available. Read repository instructions and engine version files before editing.

## Safe inspection

1. Identify the project root and current engine version.
2. Read the smallest relevant source, configuration, and test files.
3. Check version control status before changing generated or serialized files.
4. Find the repository's existing build, test, formatting, and launch commands.
5. Preserve the established architecture and naming conventions.

Treat engine-generated, imported, and binary assets as opaque unless an engine-aware tool is available. Never rewrite binary scenes, packages, caches, or imported artifacts as text.

## Verification ladder

Use the strongest available layers in this order:

1. Static checks and compilation
2. Engine-native unit or edit-mode tests
3. Runtime or play-mode tests
4. Project build, cook, package, or export
5. Interactive boot and representative gameplay
6. Screenshot and visual-state comparison
7. Performance capture on the target platform

Do not claim end-to-end success from compilation alone. If the engine or licensed platform tooling is unavailable, run every lower layer that is available and state exactly what remains unverified.

## Cross-platform expectations

- Discover engine executables instead of hardcoding one installation path.
- Quote paths as individual process arguments and avoid shell interpolation.
- Keep platform-specific output outside source asset directories.
- Preserve line endings and case-sensitive asset paths.
- Verify input with keyboard and pointer plus any controller or touch path in scope.
- Test at least one constrained rendering profile before calling a game optimized.

## Performance baseline

Measure before optimizing. Record target frame rate, frame time, CPU time, GPU time, memory, loading time, and build size where the engine exposes them. Profile representative gameplay rather than an empty scene. Re-measure the same capture after each meaningful optimization.
