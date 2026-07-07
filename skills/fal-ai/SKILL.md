---
name: fal.ai
description: |
  Generate images, videos, and music through Cybara's fal.ai media providers.
  Use when the user wants fal.ai models, queue-backed video generation, audio/music generation, or non-OpenAI image models.
metadata: {"cybara":{"primaryEnv":"FAL_KEY","homepage":"https://fal.ai","requires":{"anyEnv":["FAL_KEY","FAL_API_KEY"]}}}
---

# fal.ai

Use Cybara's media generation tools instead of calling fal.ai directly:

- `image_generate` for images and image variations
- `video_generate` for queue-backed video models
- `music_generate` for music and audio models

The provider accepts either `FAL_KEY` or `FAL_API_KEY`. Generated assets are saved under the workspace `.cybara/media/` directory and returned as local paths.

## Model Guidance

- Fast image drafts: `fal-ai/flux/schnell`
- Higher-quality image work: pass a specific fal model id in `model`
- Short videos: `fal-ai/minimax/video-01`, `fal-ai/kling-video`, or `fal-ai/veo3`
- Music/audio: `fal-ai/minimax-music/v2.6`, `fal-ai/ace-step/prompt-to-audio`, or `fal-ai/stable-audio-25/text-to-audio`

## Examples

```json
{"name":"image_generate","args":{"provider":"fal","model":"fal-ai/flux/schnell","prompt":"product photo of a compact AI workstation on a walnut desk","count":1}}
```

```json
{"name":"video_generate","args":{"provider":"fal","model":"fal-ai/minimax/video-01","prompt":"a short cinematic orbit around a glassy desktop app icon","durationSeconds":5}}
```

```json
{"name":"music_generate","args":{"provider":"fal","model":"fal-ai/minimax-music/v2.6","prompt":"focused ambient electronic loop for coding","durationSeconds":30,"format":"mp3"}}
```
