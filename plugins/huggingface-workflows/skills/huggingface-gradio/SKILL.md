---
name: huggingface-gradio
description: Build, test, and publish accessible Gradio interfaces for models and data workflows using reproducible Python environments.
metadata: {"cybara":{"homepage":"https://www.gradio.app/docs","os":["darwin","linux","win32"]}}
---

# Hugging Face Gradio

Use Gradio for focused model demos, dataset tools, and internal evaluation interfaces.

## Workflow

1. Define the smallest input and output schema that demonstrates the workflow.
2. Put model loading outside the request handler and bound concurrency, queue size, timeouts, and upload sizes.
3. Validate file types and user input before inference.
4. Build the app in a UV-managed environment and run it locally first.
5. Exercise keyboard navigation, labels, loading, empty, error, cancellation, and mobile-width states.
6. Measure cold start and warmed request latency.
7. Add authentication before exposing private models, datasets, or outputs.

Do not enable a public share link or deploy a Space unless the user explicitly requests that external action. Before deployment, review secrets, repository visibility, hardware, sleep behavior, and expected cost.
