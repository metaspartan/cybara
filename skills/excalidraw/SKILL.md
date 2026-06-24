---
name: excalidraw
description: Hand-drawn-style diagrams and sketches via the Excalidraw format (.excalidraw JSON), exportable to SVG/PNG. Use for whiteboard-style, concept, and freeform sketches.
---

# Excalidraw

Excalidraw produces clean hand-drawn-style diagrams. Emit a `.excalidraw` JSON file the user can open in the Excalidraw editor (or excalidraw CLI), and optionally export to SVG.

## When to use

- "make an excalidraw / sketch / whiteboard of …"
- Concept maps, org charts, rough architecture sketches where a polished SVG is overkill.
- The user explicitly asks for hand-drawn style.

## How to produce

1. Compose the scene as `.excalidraw` JSON: elements (`rectangle`, `ellipse`, `diamond`, `arrow`, `line`, `text`) with `x/y/width/height`, `strokeColor`, `backgroundColor`, `fontSize`, and bound labels.
2. Connect shapes with arrows that reference `startBinding`/`endBinding` to element IDs so they stay attached.
3. Save to `<name>.excalidraw` and state the path.
4. If a static export is wanted, convert to SVG/PNG (excalidraw CLI or the npm `@excalidraw/utils` package via `bunx`).

## Minimal element template

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "cybara",
  "elements": [
    {
      "type": "rectangle", "x": 100, "y": 100, "width": 160, "height": 60,
      "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
      "id": "node1", "seed": 1, "roughness": 1, "strokeWidth": 2
    },
    {
      "type": "text", "x": 130, "y": 122, "width": 100, "height": 20,
      "text": "Service A", "fontSize": 16, "id": "t1", "seed": 2
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" }
}
```

Keep element IDs unique; use `seed` values to keep rendering deterministic. Prefer grouping with a consistent palette.
