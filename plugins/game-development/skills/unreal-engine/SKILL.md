---
name: unreal-engine
description: Build, debug, test, package, and optimize Unreal Engine projects using C++, Blueprints, Automation Tests, Unreal Build Tool, and Automation Tool. Use for `.uproject` work and Unreal-specific runtime or editor issues.
---

# Unreal Engine

## Inspect first

1. Locate the `.uproject` file and read its engine association and enabled plugins.
2. Inspect `Source`, project plugins, `Config`, target files, module build files, and nearby tests.
3. Determine whether the behavior belongs in C++, Blueprint, data assets, editor tooling, or configuration.
4. Discover the installed editor and `RunUAT` or `RunUBT` entrypoint without assuming one platform path.

Never text-edit `.uasset` or `.umap` files. Use source changes, configuration, commandlets, or an engine-aware editor workflow.

## Implementation rules

- Keep gameplay rules out of actors and widgets when a subsystem, component, or plain testable type is a better owner.
- Preserve reflection macros, module boundaries, object lifetime, replication authority, and thread affinity.
- Treat asset references and gameplay tags as contracts; verify renames and redirects.
- Avoid broad Blueprint reconstruction or resaves for a focused code change.
- Do not rely on hot reload as final verification after changing reflected types.

## Verification

Use the project's existing scripts when present. Otherwise select the narrowest engine-native checks:

1. Compile the affected target with Unreal Build Tool.
2. Run relevant Automation Tests through the editor or command line.
3. Use a command shaped like `UnrealEditor-Cmd <project> -ExecCmds="Automation RunTest <filter>;Quit" -ReportExportPath=<path> -unattended -nop4` only after resolving the actual executable and test filter.
4. Use Automation Tool for build, cook, stage, package, deploy, or Gauntlet flows already supported by the project.
5. Launch the correct map and exercise the changed player flow.
6. Inspect logs for ensures, access violations, asset load failures, shader failures, and automation errors.

## Performance

Capture representative frame timing before changing performance-sensitive code. Distinguish game thread, render thread, GPU, streaming, shader compilation, and memory pressure. Validate packaged behavior because editor timing is not a shipping baseline.

## Completion criteria

Report the target and configuration compiled, automation filter and result, map or gameplay flow exercised, package status, and any editor-only verification limitation.
