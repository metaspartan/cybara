# Cybara Plugins

Cybara plugins are trusted extension bundles and connected capabilities that expand an agent without patching core.

## Plugin hub

The Plugins surfaces in web, Tauri, native macOS, mobile, CLI, and TUI organize:

- installed bundles that contribute reusable skills
- a searchable catalog of curated built-in workflow bundles
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
cybara plugin discover
cybara plugin discover research
cybara plugin enable developer-essentials
cybara plugin disable developer-essentials
cybara plugin validate /path/to/plugin
cybara plugin install /path/to/plugin
cybara plugin install /path/to/plugin.zip
cybara plugin remove acme-plugin
cybara plugin apps
cybara plugin connect google_workspace
```

## API

```text
GET    /api/plugins
GET    /api/plugins/catalog
GET    /api/plugins/validate?path=...
POST   /api/plugins/validate
POST   /api/plugins/install
PUT    /api/plugins/:id
DELETE /api/plugins/:id
```

## Constraints

- skill contribution paths must stay inside the plugin root
- absolute contribution paths are ignored
- only existing skill directories are loaded
- built-in workflow bundles are installed and enabled by default
- enablement is persisted locally and changes take effect without restarting the gateway
- local plugin installation accepts a folder, manifest, or ZIP bundle
- browser installs upload a selected folder or ZIP for manifest review before installation
- archives reject unsafe paths, links, ambiguous manifests, and oversized contents
- account app writes remain approval-gated
- MCP installation and execution require explicit trusted actions

## Security

Plugins are trusted local code. They are not sandboxed simply because they are “plugins”.

For production hosts:

- review plugin manifests, skill content, and MCP packages before install
- prefer project-scoped workspace plugins when possible
- avoid installing plugins from unreviewed sources on operator machines
- treat plugin install/remove as privileged operational changes
