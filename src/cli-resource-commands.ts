export type CliResourceFetch = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

interface ArtifactRow {
  sessionId: string;
  name: string;
  title?: string;
  kind?: string;
  size?: number;
}

interface JourneyEvent {
  kind: string;
  title: string;
  category?: string;
  createdAt?: string;
}

function formatBytes(value = 0): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export async function printArtifacts(fetchAPI: CliResourceFetch, json = false): Promise<void> {
  const response = await fetchAPI<{ artifacts?: ArtifactRow[] }>("/api/artifacts");
  if (!response) throw new Error("Unable to load artifacts from the gateway");
  const artifacts = response?.artifacts || [];
  if (json) {
    console.log(JSON.stringify({ artifacts }, null, 2));
    return;
  }
  console.log(`ARTIFACTS (${artifacts.length})`);
  console.log("============");
  if (artifacts.length === 0) {
    console.log("No artifacts created yet");
    return;
  }
  for (const artifact of artifacts) {
    console.log(`- ${artifact.title || artifact.name}`);
    console.log(
      `  ${artifact.kind || "custom"} · ${formatBytes(artifact.size)} · ${artifact.sessionId}`
    );
  }
}

export async function printJourney(fetchAPI: CliResourceFetch, json = false): Promise<void> {
  const response = await fetchAPI<{
    events?: JourneyEvent[];
    counts?: { skills?: number; memories?: number; total?: number };
  }>("/api/journey");
  if (!response) throw new Error("Unable to load journey from the gateway");
  const events = response?.events || [];
  if (json) {
    console.log(JSON.stringify(response || { events: [], counts: {} }, null, 2));
    return;
  }
  const counts = response?.counts;
  console.log("JOURNEY");
  console.log("=======");
  console.log(
    `${counts?.skills || 0} skills · ${counts?.memories || 0} memories · ${counts?.total || events.length} total`
  );
  console.log("");
  if (events.length === 0) {
    console.log("No learned skills or memories recorded yet");
    return;
  }
  for (const event of events.slice(0, 20)) {
    console.log(`- [${event.kind}] ${event.title}`);
    console.log(
      `  ${event.category || "general"}${event.createdAt ? ` · ${event.createdAt}` : ""}`
    );
  }
}
