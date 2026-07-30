---
name: transformers-js
description: Build and validate local browser or Bun inference with Hugging Face Transformers.js, WebGPU or WASM backends, quantization, caching, and cleanup.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/transformers.js","os":["darwin","linux","win32"]}}
---

# Transformers.js

Use `@huggingface/transformers` for JavaScript or TypeScript inference in Bun, Node-compatible runtimes, and browsers.

## Setup

```bash
bun add @huggingface/transformers
```

```ts
import { pipeline } from "@huggingface/transformers";

const classifier = await pipeline("text-classification");
try {
  const result = await classifier("Cybara runs this model locally.");
  console.log(result);
} finally {
  await classifier.dispose();
}
```

## Workflow

1. Choose a model whose card lists Transformers.js or ONNX compatibility for the required task.
2. Pin the model ID and revision when reproducibility matters.
3. Start with CPU/WASM compatibility, then enable WebGPU only after feature detection.
4. Select dtype or quantization from measured memory, latency, and quality requirements.
5. Configure the cache explicitly for desktop or server runtimes.
6. Warm the model before benchmarking and separate download time from inference latency.
7. Dispose pipelines and tensors when the workflow ends.
8. Test unavailable WebGPU, interrupted downloads, offline cache reuse, and malformed inputs.

Do not load untrusted custom model code. For browser applications, keep model downloads visible to the user and avoid blocking the main thread during initialization or long inference.
