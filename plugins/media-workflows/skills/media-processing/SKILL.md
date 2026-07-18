---
name: media-processing
description: Inspect, convert, compress, segment, and validate audio and video files with FFmpeg and FFprobe.
metadata: {"cybara":{"os":["darwin","linux","win32"],"requires":{"anyBins":["ffmpeg","ffprobe"]}}}
---

# Media processing

Use FFprobe to inspect source media and FFmpeg for deterministic transformations.

## Workflow

1. Inspect streams, codecs, duration, frame rate, dimensions, color metadata, channels, and sample rate.
2. Preserve the source and write transformed output to a distinct path.
3. Select codecs and quality settings from the requested delivery target rather than using arbitrary defaults.
4. Preserve aspect ratio and avoid unintended frame-rate or color-space conversion.
5. Validate output with FFprobe, decode checks, file size, duration, and representative frame or waveform inspection.
6. Report the command, input and output paths, key media properties, and validation result.

## Safety

- Confirm before overwriting media or deleting intermediates.
- Quote paths and avoid shell interpolation of untrusted metadata.
- Bound preview extraction and do not decode an entire large asset when samples are sufficient.
