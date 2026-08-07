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

export interface JourneyEdge {
  source: string;
  target: string;
  weight: number;
  kind: "category" | "topic";
}

export interface JourneyResponse {
  events: JourneyEvent[];
  edges: JourneyEdge[];
  counts: { skills: number; memories: number; total: number };
  firstAt: string | null;
  lastAt: string | null;
}

const EDGE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "will",
  "not",
  "but",
  "can",
  "use",
  "using",
  "used",
  "when",
  "how",
  "why",
  "what",
  "which",
  "them",
  "they",
  "its",
  "our",
  "out",
  "get",
  "set",
  "run",
  "new",
  "one",
  "all",
  "any",
  "per",
  "via",
  "add",
  "via",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "at",
  "is",
  "it",
  "or",
  "as",
  "be",
  "by",
  "do",
  "if",
  "so",
  "up",
  "we",
  "me",
  "my",
  "no",
]);

const MAX_EDGES_PER_NODE = 4;
const MIN_TOPIC_OVERLAP = 2;

function significantTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || EDGE_STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

function normalizeCategory(category: string): string {
  return category.trim().toLowerCase();
}

export function buildJourneyEdges(events: JourneyEvent[]): JourneyEdge[] {
  const nodes = events.map((event) => ({
    id: event.id,
    category: normalizeCategory(event.category),
    tokens: significantTokens(`${event.title} ${event.detail}`),
  }));

  const scored: Array<JourneyEdge & { score: number }> = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      let overlap = 0;
      for (const token of a.tokens) {
        if (b.tokens.has(token)) overlap += 1;
      }
      const sameCategory =
        a.category.length > 0 && a.category !== "note" && a.category === b.category;
      if (!sameCategory && overlap < MIN_TOPIC_OVERLAP) continue;
      const kind: JourneyEdge["kind"] = overlap >= MIN_TOPIC_OVERLAP ? "topic" : "category";
      const score = overlap + (sameCategory ? 1.5 : 0);
      scored.push({ source: a.id, target: b.id, weight: score, kind, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const degree = new Map<string, number>();
  const edges: JourneyEdge[] = [];
  for (const edge of scored) {
    const sourceDegree = degree.get(edge.source) ?? 0;
    const targetDegree = degree.get(edge.target) ?? 0;
    if (sourceDegree >= MAX_EDGES_PER_NODE || targetDegree >= MAX_EDGES_PER_NODE) continue;
    degree.set(edge.source, sourceDegree + 1);
    degree.set(edge.target, targetDegree + 1);
    edges.push({
      source: edge.source,
      target: edge.target,
      weight: Math.round(edge.weight * 100) / 100,
      kind: edge.kind,
    });
  }
  return edges;
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

export function journeyDisplayText(value: string, maxLength: number): string {
  const plain = value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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
      const title = journeyDisplayText(item.content.split("\n")[0], 120);
      events.push({
        id: `memory:${entry.file}:${item.index}`,
        kind: "memory",
        title: title || item.type || "Memory",
        detail: journeyDisplayText(item.content, 800),
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
    edges: buildJourneyEdges(events),
    counts: { skills: skillsCount, memories: events.length - skillsCount, total: events.length },
    firstAt: withTime.length
      ? new Date(withTime[withTime.length - 1].createdAtMs).toISOString()
      : null,
    lastAt: withTime.length ? new Date(withTime[0].createdAtMs).toISOString() : null,
  };
}
