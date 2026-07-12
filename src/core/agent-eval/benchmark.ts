import db from "../database";

export interface IntelligenceBenchmarkTask {
  id: string;
  label: string;
  category: "instruction" | "reasoning" | "coding" | "transformation" | "tool_use";
  prompt: string;
  expected: string;
  difficulty: "basic" | "intermediate" | "advanced";
  weight: number;
  requiredTool?: string;
}

export interface IntelligenceBenchmarkResult {
  taskId: string;
  label: string;
  category: IntelligenceBenchmarkTask["category"];
  passed: boolean;
  score: number;
  response: string;
  expected: string;
  difficulty: IntelligenceBenchmarkTask["difficulty"];
  weight: number;
  gradingReason: string;
  durationMs: number;
  toolCalls: string[];
  error: string | null;
}

export interface IntelligenceBenchmarkRun {
  id: string;
  suiteId: string;
  agentId: string;
  provider: string | null;
  model: string | null;
  status: "running" | "completed" | "error";
  score: number;
  currentTask: number;
  results: IntelligenceBenchmarkResult[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface BenchmarkRunRow {
  id: string;
  suite_id: string;
  agent_id: string;
  provider: string | null;
  model: string | null;
  status: IntelligenceBenchmarkRun["status"];
  score: number;
  current_task: number;
  results_json: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export const QUICK_INTELLIGENCE_SUITE_ID = "cybara-quick-intelligence-v2";

export const quickIntelligenceTasks: IntelligenceBenchmarkTask[] = [
  {
    id: "instruction-exact",
    label: "Exact instruction",
    category: "instruction",
    prompt: "Reply with exactly CYBARA and no other text.",
    expected: "CYBARA",
    difficulty: "basic",
    weight: 1,
  },
  {
    id: "arithmetic",
    label: "Arithmetic",
    category: "reasoning",
    prompt: "Compute (37 × 19) + 8. Reply with the number only.",
    expected: "711",
    difficulty: "basic",
    weight: 1,
  },
  {
    id: "logic",
    label: "Deductive logic",
    category: "reasoning",
    prompt: "All nims are veks. No veks are tars. Can any nim be a tar? Reply only YES or NO.",
    expected: "NO",
    difficulty: "intermediate",
    weight: 2,
  },
  {
    id: "combinatorics",
    label: "Combinatorics",
    category: "reasoning",
    prompt:
      "How many onto functions exist from a labeled five-element set to a labeled three-element set? Reply with the integer only.",
    expected: "150",
    difficulty: "advanced",
    weight: 3,
  },
  {
    id: "probability",
    label: "Exact probability",
    category: "reasoning",
    prompt:
      "An urn has 3 red and 2 blue balls. Two are drawn uniformly without replacement. Reply with the reduced fraction for the probability that both have the same color.",
    expected: "2/5",
    difficulty: "advanced",
    weight: 3,
  },
  {
    id: "code-trace",
    label: "Code tracing",
    category: "coding",
    prompt: "Let x = 3. Repeat x = x * 2 - 1 exactly four times. Reply with the final number only.",
    expected: "33",
    difficulty: "intermediate",
    weight: 2,
  },
  {
    id: "algorithm-analysis",
    label: "Algorithm analysis",
    category: "coding",
    prompt:
      "A binary search checks one midpoint per iteration in a sorted array of 1000 distinct items. What is the maximum number of midpoint checks needed to find an existing item? Reply with the integer only.",
    expected: "10",
    difficulty: "advanced",
    weight: 3,
  },
  {
    id: "transformation",
    label: "Text transformation",
    category: "transformation",
    prompt: "Reverse the letters in stressed. Reply with the reversed word only.",
    expected: "desserts",
    difficulty: "basic",
    weight: 1,
  },
  {
    id: "structured-output",
    label: "Structured output",
    category: "transformation",
    prompt:
      'Return exactly this compact JSON object with keys in the shown order: language is "TypeScript", runtime is "Bun", and stable is true.',
    expected: '{"language":"TypeScript","runtime":"Bun","stable":true}',
    difficulty: "intermediate",
    weight: 2,
  },
  {
    id: "grounded-read",
    label: "Grounded tool use",
    category: "tool_use",
    prompt:
      "Use the read tool to read benchmark.txt in the workspace. Reply with only its exact contents.",
    expected: "ORCHID-742",
    difficulty: "intermediate",
    weight: 2,
    requiredTool: "read",
  },
];

function fromRow(row: BenchmarkRunRow): IntelligenceBenchmarkRun {
  return {
    id: row.id,
    suiteId: row.suite_id,
    agentId: row.agent_id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    score: row.score,
    currentTask: row.current_task,
    results: JSON.parse(row.results_json) as IntelligenceBenchmarkResult[],
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function createIntelligenceBenchmarkRun(input: {
  agentId: string;
  provider?: string | null;
  model?: string | null;
}): IntelligenceBenchmarkRun {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO agent_benchmark_runs
      (id, suite_id, agent_id, provider, model, status, score, current_task, results_json)
     VALUES (?, ?, ?, ?, ?, 'running', 0, 0, '[]')`
  ).run(
    id,
    QUICK_INTELLIGENCE_SUITE_ID,
    input.agentId,
    input.provider ?? null,
    input.model ?? null
  );
  const row = db
    .prepare("SELECT * FROM agent_benchmark_runs WHERE id = ?")
    .get(id) as BenchmarkRunRow;
  return fromRow(row);
}

export function updateIntelligenceBenchmarkRun(
  id: string,
  results: IntelligenceBenchmarkResult[],
  completed: boolean
): IntelligenceBenchmarkRun {
  const totalWeight = results.reduce((total, result) => total + result.weight, 0);
  const earnedWeight = results.reduce(
    (total, result) => total + (result.passed ? result.weight : 0),
    0
  );
  const score = totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 10_000) / 100;
  db.prepare(
    `UPDATE agent_benchmark_runs SET
      status = ?, score = ?, current_task = ?, results_json = ?, completed_at = ?
     WHERE id = ?`
  ).run(
    completed ? "completed" : "running",
    score,
    results.length,
    JSON.stringify(results),
    completed ? new Date().toISOString() : null,
    id
  );
  const row = db
    .prepare("SELECT * FROM agent_benchmark_runs WHERE id = ?")
    .get(id) as BenchmarkRunRow;
  return fromRow(row);
}

export function failIntelligenceBenchmarkRun(id: string, error: string): IntelligenceBenchmarkRun {
  db.prepare(
    "UPDATE agent_benchmark_runs SET status = 'error', error = ?, completed_at = ? WHERE id = ?"
  ).run(error, new Date().toISOString(), id);
  const row = db
    .prepare("SELECT * FROM agent_benchmark_runs WHERE id = ?")
    .get(id) as BenchmarkRunRow;
  return fromRow(row);
}

export function recoverInterruptedBenchmarkRuns(): number {
  return db
    .prepare(
      "UPDATE agent_benchmark_runs SET status = 'error', error = 'Gateway restarted before the benchmark completed', completed_at = CURRENT_TIMESTAMP WHERE status = 'running'"
    )
    .run().changes;
}

export function listIntelligenceBenchmarkRuns(limit = 50): IntelligenceBenchmarkRun[] {
  const rows = db
    .prepare("SELECT * FROM agent_benchmark_runs ORDER BY created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(200, Math.floor(limit)))) as BenchmarkRunRow[];
  return rows.map(fromRow);
}

export function findRunningIntelligenceBenchmark(): IntelligenceBenchmarkRun | null {
  const row = db
    .prepare(
      "SELECT * FROM agent_benchmark_runs WHERE status = 'running' ORDER BY created_at LIMIT 1"
    )
    .get() as BenchmarkRunRow | null;
  return row ? fromRow(row) : null;
}

export function normalizeBenchmarkAnswer(value: string): string {
  return value
    .trim()
    .replace(/^\\boxed\{(.+)\}$/s, "$1")
    .replace(/^\\frac\{([^{}]+)\}\{([^{}]+)\}$/s, "$1/$2")
    .replace(/^['"`]|['"`]$/g, "")
    .trim();
}

export function gradeIntelligenceBenchmarkTask(
  task: IntelligenceBenchmarkTask,
  response: string,
  toolCalls: string[]
): boolean {
  const answerMatches =
    normalizeBenchmarkAnswer(response).toLowerCase() === task.expected.toLowerCase();
  const toolMatches =
    !task.requiredTool ||
    toolCalls.some(
      (name) => name === task.requiredTool || name.startsWith(`${task.requiredTool}_`)
    );
  return answerMatches && toolMatches;
}

export function explainIntelligenceBenchmarkGrade(
  task: IntelligenceBenchmarkTask,
  response: string,
  toolCalls: string[]
): string {
  const answerMatches =
    normalizeBenchmarkAnswer(response).toLowerCase() === task.expected.toLowerCase();
  if (!answerMatches) return "The normalized answer did not match the objective expected value.";
  if (
    task.requiredTool &&
    !toolCalls.some(
      (name) => name === task.requiredTool || name.startsWith(`${task.requiredTool}_`)
    )
  ) {
    return `The answer matched, but the required ${task.requiredTool} tool was not observed.`;
  }
  return task.requiredTool
    ? `The answer matched and the required ${task.requiredTool} tool was observed.`
    : "The normalized answer matched the objective expected value.";
}

recoverInterruptedBenchmarkRuns();
