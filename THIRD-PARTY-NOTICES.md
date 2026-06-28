# Third-Party Notices

Cybara is licensed under the MIT License (see `LICENSE.md`). It depends on
third-party packages distributed under their own licenses. The overwhelming
majority are permissive (MIT, Apache-2.0, ISC, BSD). This file calls out the
non-permissive (copyleft) transitive dependencies and their obligations.

Generate a full machine-readable inventory at any time with:

```bash
bun pm ls --all          # dependency tree
# or a license report via a tool such as license-checker
```

## LGPL components (dynamically linked / unmodified)

These are consumed as unmodified, separately-installed libraries. Under the
LGPL, distributing them this way is compatible with Cybara's MIT license, but
recipients must be able to replace/relink them. We do not modify them.

| Package | License | Pulled in via |
| --- | --- | --- |
| `rpc-websockets` | LGPL-3.0-only | `@solana/web3.js` (Solana wallet/RPC) |
| `node-webpmux` | LGPL-3.0-or-later | `whatsapp-web.js` (WhatsApp channel) |
| `@img/sharp-libvips-*` (libvips) | LGPL-3.0-or-later | `sharp` (image processing) |

## Other notable licenses

| Package | License | Notes |
| --- | --- | --- |
| `argparse` | Python-2.0 | Permissive, MIT/GPL-compatible. |

> Note: the GPL-3.0 `cfonts` dependency (formerly pulled in transitively by
> `ink-big-text` for the CLI banner) has been removed; Cybara no longer bundles
> any GPL-licensed code.

If you redistribute Cybara binaries, retain this notice and the upstream license
texts for the components above.
