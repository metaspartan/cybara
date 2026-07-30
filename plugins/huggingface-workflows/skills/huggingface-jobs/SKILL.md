---
name: huggingface-jobs
description: Plan, launch, inspect, monitor, and cancel authenticated Hugging Face Jobs for CPU, GPU, TPU, batch, inference, and data workloads.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/huggingface_hub/guides/jobs","os":["darwin","linux","win32"]}}
---

# Hugging Face Jobs

Use `hf jobs` for remote workloads. Jobs consume paid compute and run outside the local workspace.

## Preflight

1. Run `hf version`, `hf jobs --help`, and `hf auth whoami`.
2. Verify the account or organization has access and sufficient credits.
3. Inspect available hardware with `hf jobs hardware`.
4. Define the command or UV script, dependencies, hardware flavor, namespace, timeout, persistence path, and expected cost boundary.
5. Present the exact launch plan and obtain confirmation before starting paid compute.

Never transmit a token in source, command arguments, or logs. Use the authenticated CLI session and pass sensitive values through the Jobs secrets mechanism.

## Execution

Prefer a self-contained UV script for Python workloads:

```bash
hf jobs uv run --detach --flavor gpu-t4-small --timeout 2h train.py
```

Use a container only when the workload requires a specific system image:

```bash
hf jobs run --detach --flavor cpu-basic --timeout 30m python:3.12 python -c "print('ready')"
```

Start with the cheapest representative smoke run. Do not scale to the full dataset or larger hardware until inputs, imports, persistence, and metrics are verified.

## Monitoring

```bash
hf jobs ps --all --format json
hf jobs inspect <job-id>
hf jobs logs <job-id> --tail 200
hf jobs stats <job-id>
hf jobs cancel <job-id>
```

After launch, report the job ID, URL, namespace, hardware, timeout, and where outputs will persist. Do not poll indefinitely. Check status when the user asks or when an active task explicitly requires completion.
