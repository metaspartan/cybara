---
name: blender-headless
description: Build, render, and visually verify 3D models with Blender's Python API in headless mode, using the image tool to inspect renders and iterate.
metadata: {"cybara":{"os":["darwin","linux","win32"]}}
---

# Blender Headless Modeling

Use this when the user wants a 3D model, scene, or render produced locally with Blender and no Blender MCP server is configured.

## Locate Blender

1. Try `which blender`, then platform defaults: `/Applications/Blender.app/Contents/MacOS/Blender`, `/usr/bin/blender`, `/snap/bin/blender`, `%ProgramFiles%\Blender Foundation\Blender*\blender.exe`.
2. Confirm with `<blender> --version` and note the major version; the Python API changes between releases.

## Build with a script

1. Write one `build_<name>.py` that resets the scene (`bpy.ops.wm.read_factory_settings(use_empty=True)`), builds geometry with `bpy.ops.mesh.primitive_*` or `bmesh`, assigns materials, adds a camera and lights, sets `scene.render.filepath` to an absolute path, and renders with `bpy.ops.render.render(write_still=True)`.
2. Keep every file write comfortably under the model output limit: build large scripts in parts (a base file, then `edit` calls that append helpers) instead of one huge `write`. A tool call cut off by the output limit loses its arguments.
3. Run `<blender> --background --python build_<name>.py` with a timeout of at least 300 seconds and capture stdout and stderr; Blender prints Python tracebacks there.
4. Prefer `BLENDER_EEVEE` (Blender 4.2+ removed the `_NEXT` suffix) or `CYCLES` with a low sample count for verification renders; render around 1400x900 PNG.
5. Save the `.blend` with `bpy.ops.wm.save_as_mainfile(filepath=...)` so the user can open the result.

## Verify visually, then iterate

1. Render at least two views (side and three-quarter) to separate PNG files.
2. Inspect each render with the `image` tool and compare it with the requested object: proportions, missing parts, floating geometry, exposure, framing.
3. Fix the script for each discrepancy, re-render, and inspect again. Do not report success from script output alone.
4. Do not delete or overwrite renders you already reported to the user; write new versions to new file names.

## Report

List the script, the `.blend`, and every render path, and describe what the final renders show.
