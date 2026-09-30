import type { Database } from "bun:sqlite";
import { collapseInstructionLedger, type AgentInstructionUpdate } from "./agent-instruction-update";

interface InstructionLedgerEntry {
  role: string;
  content?: unknown;
  instructionUpdate?: AgentInstructionUpdate;
}

function parseLedger(raw: string): InstructionLedgerEntry[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (entry): entry is InstructionLedgerEntry =>
        !!entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).role === "string"
    );
  } catch {
    return null;
  }
}

export function collapseInstructionLedgerJson(raw: string | null): string | null {
  if (!raw) return null;
  const entries = parseLedger(raw);
  if (!entries || entries.length < 2) return null;
  const collapsed = collapseInstructionLedger(entries);
  if (collapsed.length === entries.length) return null;
  return JSON.stringify(collapsed);
}

export interface InstructionLedgerRepairTarget {
  id: string;
  instructions: string | null;
}

export function selectCollapsibleInstructionLedgers(
  targets: InstructionLedgerRepairTarget[]
): InstructionLedgerRepairTarget[] {
  return targets.filter((target) => collapseInstructionLedgerJson(target.instructions) !== null);
}

export function collapsePersistedInstructionLedgers(db: Database): number {
  const targets = db
    .query<InstructionLedgerRepairTarget, []>(
      `SELECT id, json_extract(context_state, '$.instructions') AS instructions
       FROM chat_sessions
       WHERE context_state IS NOT NULL AND json_type(context_state, '$.instructions') = 'array'`
    )
    .all();
  const update = db.prepare(
    `UPDATE chat_sessions
     SET context_state = json_set(context_state, '$.instructions', json(?))
     WHERE id = ?`
  );
  let repaired = 0;
  for (const target of selectCollapsibleInstructionLedgers(targets)) {
    const collapsed = collapseInstructionLedgerJson(target.instructions);
    if (collapsed === null) continue;
    update.run(collapsed, target.id);
    repaired += 1;
  }
  return repaired;
}
