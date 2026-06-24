---
name: diagram-maker
description: Generate clean SVG/HTML diagrams for architecture, flows, sequences, ER diagrams, and whiteboards. Use when the user asks to "draw", "diagram", "visualize architecture/flow", or wants a schematic.
---

# Diagram Maker

Create clear, correct diagrams as standalone SVG or self-contained HTML files. Default to SVG (inline-able, crisp at any size); use HTML when interactivity or Mermaid/Excalidraw-style rendering is wanted.

## When to use (trigger phrases)

- "draw a diagram of …", "diagram the architecture / flow / sequence"
- "make an ER diagram", "visualize how these components interact"
- "I want a schematic / flowchart / state machine"

## How to diagram

1. **Pick the right form** for the request:
   - Architecture / components → boxes + arrows, grouped by layer.
   - Process / flow → top-to-bottom or left-to-right flowchart with decision diamonds.
   - Sequence → vertical lifelines with horizontal message arrows (ordered top→bottom).
   - Data model → entity boxes with attribute lists + relationship lines.
2. **Prefer Mermaid** when the user wants editable/portable output — emit a fenced ` ```mermaid ` block (flowchart / sequenceDiagram / erDiagram / stateDiagram-v2). Many tools render it.
3. **For SVG/HTML**, write the file with the `write` tool, then open it. Keep a `viewBox`, a consistent palette, and readable font sizes (≥12px). Label every arrow.
4. **Never fabricate relationships.** If the diagram encodes code, ground every node/edge in actual files you read first.

## Output conventions

- Save to a sensible path (e.g. `docs/diagrams/<name>.svg` or `.html`).
- State the file path clearly after writing.
- Keep diagrams legible: avoid >8 nodes per row; split into sub-diagrams when dense.

## Mermaid quick templates

```
flowchart TD
  A[Start] --> B{Decision}
  B -- yes --> C[Do thing]
  B -- no --> D[Skip]
  C --> E[(Database)]

sequenceDiagram
  participant U as User
  participant A as API
  participant DB as Database
  U->>A: POST /order
  A->>DB: insert
  DB-->>A: ok
  A-->>U: 201 Created
```

For ER diagrams use `erDiagram`; for state use `stateDiagram-v2`.
