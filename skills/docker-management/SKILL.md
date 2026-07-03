---
name: docker-management
description: Manage and debug Docker containers, images, volumes, networks, Compose stacks, and Dockerfile performance/safety.
metadata: {"cybara":{"requires":{"bins":["docker"]}}}
---

# Docker Management

Use this for container lifecycle operations, Compose stacks, image builds, logs, disk cleanup, and Dockerfile review.

## First Checks

```bash
docker --version
docker compose version
docker info
```

If Docker is not running, stop and report that instead of guessing.

## Common Tasks

| Task | Command |
|---|---|
| Running containers | `docker ps` |
| All containers | `docker ps -a` |
| Logs | `docker logs --tail 100 <name>` |
| Follow logs | `docker logs --tail 100 -f <name>` |
| Shell | `docker exec -it <name> /bin/sh` |
| Inspect | `docker inspect <name>` |
| Stats | `docker stats --no-stream` |
| Compose status | `docker compose ps` |
| Compose logs | `docker compose logs --tail 100` |
| Disk usage | `docker system df` |

## Debugging Flow

1. Identify the failing container or service.
2. Check status and exit code with `docker ps -a` or `docker compose ps`.
3. Read logs from the failing service only.
4. Inspect env, mounts, ports, healthcheck, restart policy, and network.
5. Reproduce with the smallest command or Compose service.
6. Fix the image/config and rebuild.

## Dockerfile Review

Check for:

- Pinned base image and runtime versions.
- Multi-stage builds for compiled/bundled apps.
- No secrets in `ARG`, `ENV`, layers, or copied files.
- Non-root runtime user.
- Small runtime image and explicit healthcheck where useful.
- Dependency install before source copy when caching matters.

## Cleanup Safety

Never run destructive cleanup without checking impact:

```bash
docker system df
docker image prune
docker container prune
```

Ask before `docker system prune -a --volumes`; it can remove data and rebuild caches.
