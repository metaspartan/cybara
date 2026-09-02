---
name: godot
description: Build, debug, test, export, and optimize Godot projects using GDScript or C#, scenes, resources, headless workflows, and engine-native diagnostics. Use for projects containing `project.godot`.
---

# Godot

## Inspect first

1. Read `project.godot` and identify the renderer, entry scene, input map, autoloads, and engine features.
2. Inspect the owning scenes, scripts, resources, addons, tests, and export presets.
3. Determine whether the project uses GDScript, C#, GDExtension, or a mixture.
4. Resolve `godot`, `godot4`, or the platform application binary instead of assuming one name.

## Implementation rules

- Keep reusable behavior in scripts and resources with explicit scene ownership.
- Preserve node paths, signal contracts, resource identifiers, and autoload APIs.
- Avoid hand-rewriting large scene or resource files when an engine-aware edit is safer.
- Keep `_process` and `_physics_process` responsibilities distinct.
- Free transient nodes and disconnect long-lived signals when ownership requires it.
- Do not change renderer or project feature versions unless requested.

## Verification

Use project-provided test addons and scripts before inventing a test command.

1. Parse focused scripts with `godot --headless --path <project> --check-only --script <script>` when supported by the script shape.
2. Import resources with `godot --headless --path <project> --editor --quit` when imports changed.
3. Run the project's GDScript, C#, or addon test suite.
4. Run a focused scene or the main project and inspect engine output.
5. Export with the existing preset using `--headless --path <project> --export-release <preset> <output>` when release output is in scope.
6. Exercise the changed flow in a rendered build.

## Performance

Measure CPU, GPU, physics, draw calls, node count, memory, resource loading, and stutter in the engine profiler. Test the selected renderer and target device; headless execution cannot validate rendering.

## Completion criteria

Report Godot version, renderer, scripts or scenes checked, test runner, export preset, rendered flow, and any unavailable platform template or device.
