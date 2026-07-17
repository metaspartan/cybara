---
name: blender-mcp
description: Create, inspect, render, and validate Blender scenes through the configured Blender MCP server.
metadata: {"cybara":{"homepage":"https://github.com/ahujasid/blender-mcp","os":["darwin","linux","win32"],"requires":{"anyBins":["uvx","blender-mcp"]}}}
---

# Blender MCP

Use the configured Blender MCP server for Blender scene work instead of controlling the Blender interface indirectly.

## Setup

1. Install the Blender server from Settings > MCP Servers > Browse Registry.
2. Open the server's Setup link and download `addon.py`.
3. In Blender, open Preferences > Add-ons, choose Install, select `addon.py`, and enable the add-on.
4. Open Blender's 3D View sidebar, select BlenderMCP, and connect the add-on.
5. Start the Blender MCP server in Cybara.

## Workflow

1. Call `get_scene_info` before changing an existing scene.
2. Call `get_object_info` for objects whose transforms, materials, modifiers, or hierarchy matter.
3. Make focused changes with `execute_blender_code` rather than one large script.
4. Call `get_viewport_screenshot` after meaningful visual changes.
5. Save the `.blend` file before destructive operations and after validated milestones.
6. Use absolute paths for renders and report every saved file path.

## Validation

- Confirm object names, transforms, materials, lights, cameras, and render settings from scene data.
- Inspect a viewport screenshot after geometry, material, lighting, or camera changes.
- Render a representative frame when the requested result depends on final render output.
- Do not claim completion when only the script executed; verify the resulting scene.

## Safety

- Treat `execute_blender_code` as host code execution with access to Blender and local files.
- Never execute untrusted scripts or downloaded code.
- Confirm before deleting scene collections, overwriting project files, or changing external assets.
- Keep optional online asset integrations disabled unless the user explicitly requests and configures them.

## Troubleshooting

- Connection refused: confirm Blender is open, the add-on is enabled, and BlenderMCP is connected.
- Server start failure: confirm `uvx` is installed and visible to Cybara.
- Timeout: split the operation into smaller calls and inspect the scene between calls.
- Conflicting sessions: use one active Blender MCP server for the Blender instance.
