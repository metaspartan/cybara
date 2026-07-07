import { statSync } from "fs";
import { getSkills } from "../core/skills";
import { handleMemoryList } from "./memory/memory-api";

export interface JourneyEvent {
  id: string;
  kind: "skill" | "memory";
  title: string;
  detail: string;
  category: string;
  createdAt: string;
  createdAtMs: number;
  source: string;
}

export interface JourneyResponse {
  events: JourneyEvent[];
  counts: { skills: number; memories: number; total: number };
  firstAt: string | null;
  lastAt: string | null;
}

function fileCreatedMs(location: string): number {
  try {
    const stat = statSync(location);
    const birth = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
    return Math.floor(birth || stat.mtimeMs);
  } catch {
    return 0;
  }
}

function parseMemoryMs(date: string, timestamp: string): number {
  const combined = Date.parse(`${date} ${timestamp}`.trim());
  if (Number.isFinite(combined)) return combined;
  const dateOnly = Date.parse(date);
  if (Number.isFinite(dateOnly)) return dateOnly;
  return 0;
}

export async function buildJourney(): Promise<JourneyResponse> {
  const events: JourneyEvent[] = [];

  for (const skill of getSkills()) {
    const createdAtMs = fileCreatedMs(skill.location);
    events.push({
      id: `skill:${skill.location}`,
      kind: "skill",
      title: skill.name,
      detail: skill.description || "",
      category: skill.category || "custom",
      createdAtMs,
      createdAt: createdAtMs > 0 ? new Date(createdAtMs).toISOString() : "",
      source: skill.location,
    });
  }

  let fallbackMs = 0;
  const { memories } = await handleMemoryList();
  for (const entry of memories) {
    fallbackMs = fileCreatedMs(entry.file) || fallbackMs;
    for (const item of entry.entries) {
      const parsed = parseMemoryMs(item.date, item.timestamp);
      const createdAtMs = parsed > 0 ? parsed : fallbackMs;
      events.push({
        id: `memory:${entry.file}:${item.index}`,
        kind: "memory",
        title: item.content.split("\n")[0].slice(0, 120) || item.type || "Memory",
        detail: item.content,
        category: item.type || "note",
        createdAtMs,
        createdAt: createdAtMs > 0 ? new Date(createdAtMs).toISOString() : "",
        source: entry.file,
      });
    }
  }

  events.sort((a, b) => b.createdAtMs - a.createdAtMs);
  const withTime = events.filter((event) => event.createdAtMs > 0);
  const skillsCount = events.filter((event) => event.kind === "skill").length;

  return {
    events,
    counts: { skills: skillsCount, memories: events.length - skillsCount, total: events.length },
    firstAt: withTime.length
      ? new Date(withTime[withTime.length - 1].createdAtMs).toISOString()
      : null,
    lastAt: withTime.length ? new Date(withTime[0].createdAtMs).toISOString() : null,
  };
}
