# Cybara Plugins

Cybara plugins are installable extension bundles that can contribute skills without patching core.

## Current scope

This first pass adds:

- plugin manifest validation
- local path install/remove
- bundled, local, and workspace plugin discovery
- plugin-contributed skill directories
- CLI and API management surface

Current plugin manifests use `cybara-plugin.json`.

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
- plugin installation uses local paths

## Security

Plugins are trusted local code. They are not sandboxed simply because they are “plugins”.

For production hosts:

- review plugin manifests and skill content before install
- prefer project-scoped workspace plugins when possible
- avoid installing plugins from unreviewed sources on operator machines
- treat plugin install/remove as privileged operational changes
