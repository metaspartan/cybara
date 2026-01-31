# AI Coding Rules for Cybara Agent Platform

This document contains coding standards and best practices for AI assistants working on this codebase.

## Runtime Environment

- **Runtime**: Bun (not Node.js)
- **Package Manager**: bun
- **TypeScript**: Strict mode enabled

## Import Rules

### ✅ DO

```typescript
// Static imports at top of file
import { homedir } from "os";
import { readFileSync, existsSync, statSync } from "fs";
import { tables } from "./database";

// No .js extension in imports (ESM standard)
import { config } from "../core/config";
```

### ❌ DON'T

```typescript
// No require() - use import instead
const fs = require("fs"); // BAD

// No require() for os.homedir()
process.env.HOME || require("os").homedir(); // BAD

// Prefer: 
import { homedir } from "os";
process.env.HOME || homedir(); // GOOD
```

### Dynamic Imports (when acceptable)

Dynamic imports are acceptable ONLY for:
1. **Circular dependency avoidance** - when two modules import each other
2. **Optional dependencies** - like Playwright which may not be installed
3. **Lazy loading at startup** - to speed up initial load time

```typescript
// Acceptable: Optional dependency
const { chromium } = await import("playwright");

// Acceptable: Circular dependency avoidance
const { listSessions } = await import("../api/chat");
```

## Bun Native APIs

### Use Bun.spawnSync instead of child_process

```typescript
// ❌ DON'T
import { execSync } from "child_process";
const output = execSync("which rg", { encoding: "utf-8" });

// ✅ DO
const result = Bun.spawnSync(["which", "rg"]);
const output = result.stdout.toString();

// For shell commands:
const result = Bun.spawnSync(["sh", "-c", "complex | shell | command"]);
```

## Database Patterns

### COALESCE for Partial Updates

When updating a record with optional fields, use SQL COALESCE to preserve existing values:

```sql
-- ❌ DON'T - this sets name to NULL if not provided
UPDATE channels SET name=?, config=?, enabled=? WHERE id=?

-- ✅ DO - preserves existing values when not provided
UPDATE channels SET 
  name=COALESCE(?, name), 
  config=COALESCE(?, config), 
  enabled=COALESCE(?, enabled) 
WHERE id=?
```

```typescript
// Pass null for fields not being updated
update: (id: string, c: Partial<Channel>) =>
  stmts.channels.update.run(
    c.name ?? null,  // null means "keep existing"
    c.config ? JSON.stringify(c.config) : null,
    c.enabled !== undefined ? (c.enabled ? 1 : 0) : null,
    id
  ),
```

## TypeScript Patterns

### Avoid `any` Type

```typescript
// ❌ DON'T
function process(data: any) { ... }

// ✅ DO
function process(data: Record<string, unknown>) { ... }
function process(data: { name: string; value: number }) { ... }
```

### Use Proper Async Patterns

```typescript
// When calling async functions, always await
const pages = await pwManager.getAllPages();

// Don't forget async when using await
async function getProfilePages() {
  const title = await page.title();
  return title;
}
```

### Handle Nullable Values

```typescript
// Use nullish coalescing
const value = data.field ?? defaultValue;

// Use optional chaining
const nested = data?.deep?.value;
```

## File Paths

### Use Relative Paths from Project Root

```typescript
// ❌ DON'T - hardcoded user paths
const memoryDir = "/Users/carsen/clawd/memory";

// ✅ DO - relative to project
const __dirname = dirname(fileURLToPath(import.meta.url));
const memoryDir = join(__dirname, "..", "..", "..", "memory");
```

### Use homedir() for User Home

```typescript
import { homedir } from "os";

const homeDir = process.env.HOME || homedir();
```

## API Response Patterns

### Consistent Field Naming

Use snake_case for API responses to match frontend expectations:

```typescript
return {
  id: session.id,
  agent_id: session.agentId,      // snake_case for API
  created_at: session.createdAt,
  updated_at: session.updatedAt,
};
```

### Sort by Relevant Timestamp

```typescript
// Sort sessions by last activity, not creation
return sessions.sort((a, b) => 
  new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
);
```

## Playwright Compatibility

### Use Current APIs

```typescript
// ❌ DON'T - deprecated API
const snapshot = await page.accessibility.snapshot();

// ✅ DO - current API (Playwright 1.58+)
const ariaSnapshot = await page.locator('body').ariaSnapshot();
```

### Define Missing Types Locally

```typescript
// If a type is not exported, define it locally
interface AXNode {
  role: string;
  name?: string;
  children?: AXNode[];
}
```

## Testing & Verification

Always verify changes compile:

```bash
bunx tsc --noEmit
```

For UI changes:

```bash
cd ui && bunx tsc --noEmit
```

## Directory Structure

```
src/
├── api/           # HTTP route handlers
├── core/          # Core business logic
│   ├── browser/   # Playwright browser management
│   ├── skills/    # Skill definitions and executors
│   └── tools/     # Tool handlers
├── ui/            # Simple HTML UI (not the Vite app)
└── index.ts       # Main entry point

ui/                # Vite React frontend
memory/            # Memory files (gitignored)  
skills/            # Custom skills (gitignored)
data/              # SQLite database (gitignored)
```

## Git Ignore Rules

These directories contain user data and should never be committed:
- `memory/` - Personal memory files
- `skills/` - User's custom skills
- `data/` - SQLite database
- `.env` - Environment variables
