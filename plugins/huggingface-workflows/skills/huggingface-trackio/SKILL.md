---
name: huggingface-trackio
description: Instrument, monitor, compare, and diagnose machine-learning experiments with Trackio metrics, alerts, dashboards, and structured exports.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/trackio","os":["darwin","linux","win32"]}}
---

# Hugging Face Trackio

Use Trackio to make training state observable and reproducible.

## Instrumentation

```python
import trackio

trackio.init(project="project-name", config={"learning_rate": 0.0001})
trackio.log({"loss": 0.1, "learning_rate": 0.0001, "step": 1})
trackio.finish()
```

Use `report_to="trackio"` when the selected trainer supports it. For remote training, configure a durable Space or other supported synchronization target so metrics survive the job.

## Required signals

- train and evaluation loss
- task-specific evaluation metrics
- learning rate and step or epoch
- examples or tokens processed per second
- GPU memory or system utilization when available
- configuration, model revision, dataset revision, and seed
- alerts for NaN/Inf values, loss divergence, stalled progress, and failed persistence

Use structured CLI output when retrieving metrics for an agent. Compare runs only after verifying that their model, data, method, and evaluation settings are compatible.

Creating or changing a public tracking Space, webhook, or external alert destination transmits data. Confirm the destination and the metrics being sent before enabling it, and never log secrets or raw sensitive examples.
