---
name: database-operations
description: Inspect schemas, debug queries, plan migrations, and validate data changes across common relational databases.
---

# Database operations

Use structured database clients or repository data-access APIs instead of parsing database files as text.

## Workflow

1. Identify the database engine, connection source, migration system, and environment before connecting.
2. Inspect schemas, indexes, constraints, and representative row counts with read-only queries first.
3. Reproduce query or migration problems against an isolated local database when possible.
4. Use query plans and measured timings for performance work.
5. Make migrations forward-safe, transactional where supported, and compatible with existing application versions.
6. Verify constraints, rollback behavior, query results, and application tests after changes.

## Safety

- Treat production and unknown databases as read-only unless the user explicitly authorizes writes.
- Never expose credentials, personal data, or unredacted row contents in chat.
- Back up data before destructive schema changes.
- Bound exploratory queries and avoid full-table exports by default.
