# Cybara Plugins

Cybara plugins are trusted extension bundles and connected capabilities that expand an agent without patching core.

## Plugin hub

The Plugins surfaces in web, Tauri, native macOS, mobile, CLI, and TUI organize:

- installed bundles that contribute reusable skills
- OAuth account apps backed by encrypted credentials
- remote and local MCP services with explicit lifecycle controls

Installable bundles use `cybara-plugin.json`.

## Manifest

```json
{
  "schemaVersion": 1,
  "id": "acme-plugin",
  "name": "Acme Plugin",
  "version": "1.2.3",
  "description": "Example Cybara plugin",
  "author": "Acme",
  "homepage": "https://example.com",
  "contributions": {
    "skills": {
      "dirs": ["skills"]
    }
  }
}
```

## Discovery order

Cybara resolves plugins from:

1. bundled repo/runtime plugins
2. local user plugins in `~/.cybara/plugins`
3. workspace plugins in `<workspace>/plugins` and `<workspace>/.cybara/plugins`

If the same plugin id exists in multiple places, workspace wins over local and local wins over bundled.

Set `CYBARA_HOME` to override the runtime data directory when packaging or testing. Local plugins then resolve from `$CYBARA_HOME/plugins`.

## CLI

```bash
cybara plugin list
cybara plugin validate /path/to/plugin
cybara plugin install /path/to/plugin
cybara plugin remove acme-plugin
cybara plugin apps
cybara plugin connect google_workspace
```

## API

```text
GET    /api/plugins
GET    /api/plugins/validate?path=...
POST   /api/plugins/install
DELETE /api/plugins/:id
```

## Constraints

- skill contribution paths must stay inside the plugin root
- absolute contribution paths are ignored
- only existing skill directories are loaded
- plugin bundle installation uses local paths
- account app writes remain approval-gated
- MCP installation and execution require explicit trusted actions

## Security

Plugins are trusted local code. They are not sandboxed simply because they are “plugins”.

For production hosts:

- review plugin manifests, skill content, and MCP packages before install
- prefer project-scoped workspace plugins when possible
- avoid installing plugins from unreviewed sources on operator machines
- treat plugin install/remove as privileged operational changes
