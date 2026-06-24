---
name: manim-video
description: Generate mathematical/explanatory animations with Manim (Python). Use for animated explainers, math visualizations, and step-by-step animations the user can render to MP4.
metadata: {"cybara":{"requires":{"bins":["python3"]},"install":[{"id":"pip","kind":"pip","pkg":"manim","bins":["manim"],"label":"Install Manim (pip)"}]}}
---

# Manim Video

Manim is an animation engine (Python) for precise mathematical/explanatory videos. Write a scene, render it to MP4 with `manim`.

## When to use

- "animate / make a video showing …"
- Math derivations, algorithm visualizations, geometric constructions.
- Step-by-step explainers.

## Workflow

1. Write a Python scene file using the Manim API. Save with the `write` tool, e.g. `scene.py`.
2. Render: `manim -pql scene.py SceneName` (low quality preview, `-p` plays after). Use `-pqh` for high quality / final.
3. Output MP4 lands under `media/videos/...`. State the path.

## Minimal scene template

```python
from manim import *

class Squares(Scene):
    def construct(self):
        s = Square(side_length=2, color=BLUE)
        self.play(Create(s))
        self.play(s.animate.rotate(PI / 2).set_color(RED))
        self.wait()
```

## Tips

- Keep scenes short and focused; one idea per scene.
- Animate one property change per `self.play(...)` step so it reads clearly.
- For text, use `MathTex` (LaTeX math) or `Text` (plain).
- Prefer `-ql` previews while iterating; switch to `-qh` only for the final render.
- Requires `python3` and the `manim` package (install via pip). Per project rules, never use npm-equivalents for JS; here Manim is Python so pip is correct.
