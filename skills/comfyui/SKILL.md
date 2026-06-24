---
name: comfyui
description: Drive ComfyUI (local Stable Diffusion / image-gen pipeline) via its HTTP API to generate and edit images. Use when the user has ComfyUI running and wants image generation/upscale/img2img workflows.
metadata: {"cybara":{"requires":{"bins":[]},"note":"Requires a local or remote ComfyUI server reachable via HTTP"}}
---

# ComfyUI

ComfyUI is a node-based Stable Diffusion pipeline with an HTTP API. Generate images by posting a workflow (prompt graph) and polling for results.

## When to use

- "generate an image of … (via ComfyUI)"
- img2img, inpainting, upscaling, or custom SDXL/Flux workflows.
- The user references ComfyUI explicitly or has it installed.

## How it works

1. **Build a workflow graph** as JSON (`prompt` API). Each node has a `class_type` and `inputs`. A minimal txt2img graph: CheckpointLoader → CLIPTextEncode (pos/neg) → EmptyLatentImage → KSampler → VAEDecode → SaveImage.
2. **Submit:** `POST /prompt` with `{"prompt": <graph>, "client_id": <id>}`. Returns a `prompt_id`.
3. **Poll history:** `GET /history/<prompt_id>` until the output image(s) appear, then fetch from `/view?filename=…`.
4. Save outputs to the workspace and state their paths.

## Minimal node template (txt2img)

```json
{
  "3": { "class_type": "KSampler", "inputs": {
      "seed": 42, "steps": 25, "cfg": 7, "sampler_name": "euler", "scheduler": "normal",
      "denoise": 1, "model": ["4",0], "positive": ["6",0], "negative": ["7",0],
      "latent_image": ["5",0] } },
  "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sdxl_base.safetensors" } },
  "5": { "class_type": "EmptyLatentImage", "inputs": { "width": 1024, "height": 1024, "batch_size": 1 } },
  "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "<prompt>", "clip": ["4",1] } },
  "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "<negative>", "clip": ["4",1] } },
  "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3",0], "vae": ["4",2] } },
  "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "cybara", "images": ["8",0] } }
}
```

## Notes

- Default server: `http://127.0.0.1:8188` (override via the request URL).
- Use the `http` tool to submit/poll; you don't need raw `fetch`.
- For img2img/inpaint, add `LoadImage` + replace `EmptyLatentImage`; lower `denoise` (~0.5–0.75) to keep structure.
- Always state the server URL and output path in your response.
