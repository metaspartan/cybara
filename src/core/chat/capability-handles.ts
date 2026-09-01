import { normalizeCapabilityAlias } from "./capability-alias";

interface NamedCapabilityEntity {
  id: string;
  name: string;
}

function capabilityEntitySuffix(id: string): string {
  return normalizeCapabilityAlias(id).slice(0, 8) || "agent";
}

export function uniqueCapabilityHandles(
  entities: readonly NamedCapabilityEntity[]
): Map<string, string> {
  const baseHandles = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const entity of entities) {
    const handle =
      normalizeCapabilityAlias(entity.name) || `agent-${capabilityEntitySuffix(entity.id)}`;
    baseHandles.set(entity.id, handle);
    counts.set(handle, (counts.get(handle) ?? 0) + 1);
  }

  const handles = new Map<string, string>();
  for (const entity of entities) {
    const baseHandle = baseHandles.get(entity.id) ?? `agent-${capabilityEntitySuffix(entity.id)}`;
    handles.set(
      entity.id,
      counts.get(baseHandle) === 1
        ? baseHandle
        : `${baseHandle}-${capabilityEntitySuffix(entity.id)}`
    );
  }
  return handles;
}
