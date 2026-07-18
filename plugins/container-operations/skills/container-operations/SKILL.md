---
name: container-operations
description: Build, inspect, debug, and validate Docker or Podman images, containers, networks, volumes, and Compose stacks.
metadata: {"cybara":{"os":["darwin","linux","win32"],"requires":{"anyBins":["docker","podman"]}}}
---

# Container operations

Use the available container runtime for reproducible builds, local stacks, diagnostics, and deployment validation.

## Workflow

1. Detect the available runtime and inspect the repository's container and Compose files before running commands.
2. Validate configuration, resolved environment, mounts, ports, health checks, and dependency ordering.
3. Build with explicit tags and capture build failures from the first relevant error.
4. Start the smallest required service set and wait on health rather than process existence.
5. Inspect service status, bounded logs, resource usage, networks, and volumes when diagnosing failures.
6. Exercise the exposed application endpoint and stop temporary resources when validation is complete.

## Safety

- Confirm before pruning global images, builders, volumes, or networks.
- Never print secret environment values or copy credential files into an image.
- Prefer project-scoped cleanup over global cleanup.
- Preserve persistent volumes unless the user explicitly requests deletion.
