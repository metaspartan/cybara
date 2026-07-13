import type { ChatCapabilityOption } from "@/lib/api";
import {
  filterChatCapabilities as filterSharedChatCapabilities,
  findActiveCapabilityMention as findSharedActiveCapabilityMention,
  insertChatCapabilityMention as insertSharedChatCapabilityMention,
  type ActiveCapabilityMention,
} from "../../../../shared/chat-capability-picker";

export type { ActiveCapabilityMention };

export function findActiveCapabilityMention(
  value: string,
  cursor: number
): ActiveCapabilityMention | null {
  return findSharedActiveCapabilityMention(value, cursor);
}

export function filterChatCapabilities(
  options: ChatCapabilityOption[],
  query: string,
  limit = 10,
  trigger: "@" | "/" = "@"
): ChatCapabilityOption[] {
  return filterSharedChatCapabilities(options, query, limit, trigger);
}

export function insertChatCapabilityMention(
  value: string,
  active: ActiveCapabilityMention,
  token: string
): { value: string; cursor: number } {
  return insertSharedChatCapabilityMention(value, active, token);
}
