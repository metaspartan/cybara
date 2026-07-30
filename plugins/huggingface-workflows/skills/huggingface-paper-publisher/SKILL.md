---
name: huggingface-paper-publisher
description: Prepare and publish reproducible Hugging Face paper pages with linked code, models, datasets, demos, metadata, and validated claims.
metadata: {"cybara":{"homepage":"https://huggingface.co/papers","os":["darwin","linux","win32"]}}
---

# Hugging Face Paper Publisher

Prepare a publication package before changing any Hub repository or paper page.

## Package

- title, authors, affiliations, abstract, date, and stable paper identifier
- canonical paper file or URL
- code repository and immutable revision
- model and dataset repositories with licenses
- evaluation commands, raw results, hardware, and environment details
- representative figures with alt text and captions
- limitations, safety considerations, and known reproduction gaps

Verify that every linked artifact exists and that reported values match the underlying results. Remove secrets, private URLs, personal data, and local filesystem paths.

Creating repositories, uploading files, changing visibility, or publishing a page is an external side effect. Present the destination, files, metadata, and visibility for confirmation immediately before publishing. Afterward, reopen the public or private result as appropriate and verify links, rendering, and access controls.
