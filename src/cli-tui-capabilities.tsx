import React from "react";
import { Box, Text } from "ink";
import {
  filterChatCapabilities,
  findActiveCapabilityMention,
  insertChatCapabilityMention,
  type ActiveCapabilityMention,
  type SharedChatCapabilityOption,
} from "../shared/chat-capability-picker";

export type TUICapabilityOption = SharedChatCapabilityOption;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function capabilitiesFromResponse(value: unknown): TUICapabilityOption[] {
  const raw = isRecord(value) && Array.isArray(value.capabilities) ? value.capabilities : [];
  return raw.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.kind !== "string" ||
      typeof item.token !== "string" ||
      typeof item.name !== "string" ||
      typeof item.description !== "string" ||
      typeof item.source !== "string"
    ) {
      return [];
    }
    return [item as unknown as TUICapabilityOption];
  });
}

export function activeTUICapabilityMention(
  value: string,
  cursor: number
): ActiveCapabilityMention | null {
  const active = findActiveCapabilityMention(value, cursor);
  return active?.trigger === "@" ? active : null;
}

export function matchingTUICapabilities(
  options: TUICapabilityOption[],
  active: ActiveCapabilityMention | null,
  limit: number
): TUICapabilityOption[] {
  return active ? filterChatCapabilities(options, active.query, limit, "@") : [];
}

export function insertTUICapability(
  value: string,
  active: ActiveCapabilityMention,
  option: TUICapabilityOption
): { value: string; cursor: number } {
  return insertChatCapabilityMention(value, active, option.token);
}

export function CapabilityPalette({
  options,
  selectedIndex,
  maxColumns,
}: {
  options: TUICapabilityOption[];
  selectedIndex: number;
  maxColumns: number;
}): React.ReactElement | null {
  if (options.length === 0) return null;
  return (
    <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Capabilities</Text>
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        const prefix = `${selected ? "›" : " "} ${option.token} · ${option.source} · `;
        const available = Math.max(8, maxColumns - prefix.length - 4);
        const detail =
          option.description.length > available
            ? `${option.description.slice(0, available - 1)}…`
            : option.description;
        return (
          <Box key={`${option.kind}-${option.token}`}>
            <Text color={selected ? "cyan" : "white"} bold={selected}>
              {selected ? "›" : " "} {option.token} <Text color="gray">· {option.source} · {detail}</Text>
            </Text>
          </Box>
        );
      })}
      <Text color="gray">↑↓ select · Tab or Enter insert</Text>
    </Box>
  );
}
