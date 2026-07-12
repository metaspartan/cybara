import { createHash } from "crypto";
import db from "../database";

export type IntelligenceTaskCategory =
  | "instruction"
  | "reasoning"
  | "coding"
  | "transformation"
  | "tool_use";

export type IntelligenceTaskDifficulty =
  | "basic"
  | "intermediate"
  | "advanced"
  | "expert"
  | "frontier";

export interface IntelligenceBenchmarkTask {
  id: string;
  label: string;
  category: IntelligenceTaskCategory;
  prompt: string;
  expected: string;
  rating: number;
  difficulty: IntelligenceTaskDifficulty;
  weight: number;
  requiredTool?: string;
}

export interface IntelligenceBenchmarkResult {
  taskId: string;
  label: string;
  category: IntelligenceTaskCategory;
  passed: boolean;
  score: number;
  rating: number;
  response: string;
  expected: string;
  difficulty: IntelligenceTaskDifficulty;
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
  status: "running" | "completed" | "cancelled" | "error";
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

export const INTELLIGENCE_RATING_SUITE_ID = "cybara-intelligence-rating-v2";
export const LEGACY_INTELLIGENCE_SUITE_IDS = [
  "cybara-quick-intelligence-v2",
  "cybara-intelligence-rating-v1",
];
export const INTELLIGENCE_RATING_SCALE = 400;
export const INTELLIGENCE_RATING_EDGE_MARGIN = 400;

function difficultyForRating(rating: number): IntelligenceTaskDifficulty {
  if (rating < 1300) return "basic";
  if (rating < 1800) return "intermediate";
  if (rating < 2300) return "advanced";
  if (rating < 2800) return "expert";
  return "frontier";
}

function weightForRating(rating: number): number {
  if (rating < 1300) return 1;
  if (rating < 1800) return 2;
  if (rating < 2300) return 3;
  if (rating < 2800) return 4;
  return 5;
}

function task(input: {
  id: string;
  label: string;
  category: IntelligenceTaskCategory;
  prompt: string;
  expected: string;
  rating: number;
  requiredTool?: string;
}): IntelligenceBenchmarkTask {
  return {
    ...input,
    difficulty: difficultyForRating(input.rating),
    weight: weightForRating(input.rating),
  };
}

export const intelligenceRatingTasks: IntelligenceBenchmarkTask[] = [
  task({
    id: "instruction-exact",
    label: "Exact instruction",
    category: "instruction",
    prompt: "Reply with exactly CYBARA and no other text.",
    expected: "CYBARA",
    rating: 850,
  }),
  task({
    id: "addition",
    label: "Addition",
    category: "reasoning",
    prompt: "Compute 47 + 58. Reply with the number only.",
    expected: "105",
    rating: 900,
  }),
  task({
    id: "reverse-word",
    label: "String reversal",
    category: "transformation",
    prompt: "Reverse the letters in stressed. Reply with the reversed word only.",
    expected: "desserts",
    rating: 1000,
  }),
  task({
    id: "letter-count",
    label: "Letter counting",
    category: "transformation",
    prompt:
      "How many times does the letter s appear in the word assessments? Reply with the number only.",
    expected: "5",
    rating: 1150,
  }),
  task({
    id: "arithmetic-chain",
    label: "Chained arithmetic",
    category: "reasoning",
    prompt: "Compute (37 × 19) + 8. Reply with the number only.",
    expected: "711",
    rating: 1200,
  }),
  task({
    id: "syllogism",
    label: "Deductive logic",
    category: "reasoning",
    prompt: "All nims are veks. No veks are tars. Can any nim be a tar? Reply only YES or NO.",
    expected: "NO",
    rating: 1300,
  }),
  task({
    id: "code-trace-loop",
    label: "Loop tracing",
    category: "coding",
    prompt:
      "Let x = 3. Repeat x = x * 2 - 1 exactly four times. Reply with the final value of x only.",
    expected: "33",
    rating: 1400,
  }),
  task({
    id: "grounded-read",
    label: "Grounded file read",
    category: "tool_use",
    prompt:
      "Use the read tool to read benchmark.txt in the workspace. Reply with only its exact contents.",
    expected: "ORCHID-742",
    rating: 1400,
    requiredTool: "read",
  }),
  task({
    id: "json-structured",
    label: "Structured output",
    category: "transformation",
    prompt:
      'Return exactly this compact JSON object with keys in the shown order: language is "TypeScript", runtime is "Bun", and stable is true.',
    expected: '{"language":"TypeScript","runtime":"Bun","stable":true}',
    rating: 1450,
  }),
  task({
    id: "day-of-week",
    label: "Calendar arithmetic",
    category: "reasoning",
    prompt:
      "Today is Monday. What day of the week will it be 100 days from today? Reply with the day name only.",
    expected: "Wednesday",
    rating: 1500,
  }),
  task({
    id: "alphabetical-third",
    label: "Sorting",
    category: "transformation",
    prompt:
      "Sort these words alphabetically: banana, apple, cherry, date. Reply with the third word only.",
    expected: "cherry",
    rating: 1500,
  }),
  task({
    id: "binary-conversion",
    label: "Base conversion",
    category: "coding",
    prompt: "Convert the decimal number 255 to binary. Reply with the binary digits only.",
    expected: "11111111",
    rating: 1550,
  }),
  task({
    id: "units-digit-power",
    label: "Units digit",
    category: "reasoning",
    prompt: "What is the units digit of 7 to the power of 5? Reply with the digit only.",
    expected: "7",
    rating: 1600,
  }),
  task({
    id: "stack-trace",
    label: "Stack simulation",
    category: "coding",
    prompt:
      "A stack starts empty. Push 1, 2, 3, 4, 5 in order. Pop twice. Push 6. Pop once. What number is now on top? Reply with the number only.",
    expected: "3",
    rating: 1700,
  }),
  task({
    id: "binary-search-steps",
    label: "Binary search bound",
    category: "coding",
    prompt:
      "A binary search checks one midpoint per iteration in a sorted array of 1000 distinct items. What is the maximum number of midpoint checks needed to find an existing item? Reply with the number only.",
    expected: "10",
    rating: 1750,
  }),
  task({
    id: "grounded-sum",
    label: "Grounded computation",
    category: "tool_use",
    prompt:
      "Use the read tool to read data.csv in the workspace, then compute the sum of the value column. Reply with the number only.",
    expected: "92",
    rating: 1800,
    requiredTool: "read",
  }),
  task({
    id: "lcm-gcd",
    label: "LCM and GCD",
    category: "reasoning",
    prompt: "Compute lcm(12, 18) + gcd(12, 18). Reply with the number only.",
    expected: "42",
    rating: 1800,
  }),
  task({
    id: "digit-sum-power",
    label: "Digit sum",
    category: "reasoning",
    prompt:
      "What is the sum of the decimal digits of 2 to the power of 15? Reply with the number only.",
    expected: "26",
    rating: 1850,
  }),
  task({
    id: "urn-probability",
    label: "Exact probability",
    category: "reasoning",
    prompt:
      "An urn has 3 red and 2 blue balls. Two are drawn uniformly at random without replacement. What is the probability both have the same color? Reply with the reduced fraction only.",
    expected: "2/5",
    rating: 1950,
  }),
  task({
    id: "recursion-trace",
    label: "Recurrence tracing",
    category: "coding",
    prompt:
      "Define f(0) = 1, f(1) = 1, and f(n) = f(n-1) + 2*f(n-2) for n >= 2. What is f(6)? Reply with the number only.",
    expected: "43",
    rating: 2000,
  }),
  task({
    id: "onto-functions",
    label: "Combinatorics",
    category: "reasoning",
    prompt:
      "How many onto functions exist from a labeled five-element set to a labeled three-element set? Reply with the number only.",
    expected: "150",
    rating: 2150,
  }),
  task({
    id: "modular-exponent",
    label: "Modular exponentiation",
    category: "reasoning",
    prompt: "What is 3 to the power of 100, mod 7? Reply with the number only.",
    expected: "4",
    rating: 2250,
  }),
  task({
    id: "knights-knaves",
    label: "Knights and knaves",
    category: "reasoning",
    prompt:
      "On an island, knights always tell the truth and knaves always lie. Person A says: We are both knaves. What is person B? Reply only KNIGHT or KNAVE.",
    expected: "KNIGHT",
    rating: 2300,
  }),
  task({
    id: "chinese-remainder",
    label: "Simultaneous congruences",
    category: "reasoning",
    prompt:
      "Find the smallest positive integer that leaves remainder 2 when divided by 3, remainder 3 when divided by 5, and remainder 2 when divided by 7. Reply with the number only.",
    expected: "23",
    rating: 2400,
  }),
  task({
    id: "pythagorean",
    label: "Exact geometry",
    category: "reasoning",
    prompt:
      "A right triangle has legs of length 20 and 21. What is the length of the hypotenuse? Reply with the number only.",
    expected: "29",
    rating: 2450,
  }),
  task({
    id: "lattice-paths",
    label: "Lattice paths",
    category: "reasoning",
    prompt:
      "Moving only right or up along grid lines from (0,0) to (4,4), how many distinct lattice paths exist? Reply with the number only.",
    expected: "70",
    rating: 2500,
  }),
  task({
    id: "conditional-probability",
    label: "Conditional probability",
    category: "reasoning",
    prompt:
      "Three fair coins are flipped. Given that at least one shows heads, what is the probability that all three show heads? Reply with the reduced fraction only.",
    expected: "1/7",
    rating: 2550,
  }),
  task({
    id: "trailing-zeros",
    label: "Factorial zeros",
    category: "reasoning",
    prompt: "How many trailing zeros does 100 factorial have? Reply with the number only.",
    expected: "24",
    rating: 2650,
  }),
  task({
    id: "circular-seating",
    label: "Constrained seating",
    category: "reasoning",
    prompt:
      "In how many ways can 8 people be seated around a circular table if two particular people refuse to sit next to each other? Treat rotations as identical and reflections as distinct. Reply with the number only.",
    expected: "3600",
    rating: 2800,
  }),
  task({
    id: "collatz-steps",
    label: "Long process tracing",
    category: "coding",
    prompt:
      "Apply the Collatz rule (n becomes 3n+1 if n is odd, n/2 if n is even) starting at 27. How many steps are needed to reach 1? Reply with the number only.",
    expected: "111",
    rating: 2900,
  }),
  task({
    id: "smallest-divisors",
    label: "Divisor counting",
    category: "reasoning",
    prompt:
      "What is the smallest positive integer with exactly 12 positive divisors? Reply with the number only.",
    expected: "60",
    rating: 3000,
  }),
  task({
    id: "constrained-digits",
    label: "Constraint satisfaction",
    category: "reasoning",
    prompt:
      "Find the unique three-digit number where the digits sum to 18, the hundreds digit is twice the units digit, and the tens digit is the average of the hundreds and units digits. Reply with the number only.",
    expected: "864",
    rating: 3100,
  }),
  task({
    id: "domino-tiling",
    label: "Domino tilings",
    category: "reasoning",
    prompt:
      "How many ways can a 2 by 10 rectangle be completely tiled by 2 by 1 dominoes? Reply with the number only.",
    expected: "89",
    rating: 3150,
  }),
  task({
    id: "josephus-survivor",
    label: "Josephus survivor",
    category: "coding",
    prompt:
      "41 people stand in a circle, numbered 1 to 41. Counting starts at person 1 and every third person is eliminated, so persons 3 and 6 are eliminated first. Counting continues around the shrinking circle. What is the number of the last person remaining? Reply with the number only.",
    expected: "31",
    rating: 3200,
  }),
  task({
    id: "lis-length",
    label: "Longest increasing subsequence",
    category: "coding",
    prompt:
      "What is the length of the longest strictly increasing subsequence of this list: 8, 3, 11, 6, 14, 2, 17, 9, 20, 5, 23, 12, 26, 1, 29? Reply with the number only.",
    expected: "8",
    rating: 3250,
  }),
  task({
    id: "edit-distance",
    label: "Edit distance",
    category: "coding",
    prompt:
      "What is the Levenshtein edit distance between intention and execution? Reply with the number only.",
    expected: "5",
    rating: 3300,
  }),
  task({
    id: "matrix-determinant",
    label: "Matrix determinant",
    category: "reasoning",
    prompt:
      "Compute the determinant of the 3 by 3 matrix with rows [2, 3, 1], [4, 1, 5], [6, 2, 3]. Reply with the number only.",
    expected: "42",
    rating: 3300,
  }),
  task({
    id: "modpow-large",
    label: "Large modular power",
    category: "reasoning",
    prompt: "What is 2 to the power of 100, mod 1001? Reply with the number only.",
    expected: "562",
    rating: 3350,
  }),
  task({
    id: "digit-count-power",
    label: "Digit counting",
    category: "reasoning",
    prompt: "How many decimal digits does 2 to the power of 333 have? Reply with the number only.",
    expected: "101",
    rating: 3400,
  }),
  task({
    id: "derangements",
    label: "Derangements",
    category: "reasoning",
    prompt:
      "How many permutations of 7 distinct letters leave no letter in its original position? Reply with the number only.",
    expected: "1854",
    rating: 3450,
  }),
  task({
    id: "catalan-number",
    label: "Catalan number",
    category: "reasoning",
    prompt:
      "What is the 10th Catalan number, where C(0) = 1 is the 0th? Reply with the number only.",
    expected: "16796",
    rating: 3500,
  }),
  task({
    id: "partitions-20",
    label: "Integer partitions",
    category: "reasoning",
    prompt:
      "In how many ways can the integer 20 be written as a sum of positive integers, where the order of the parts does not matter? Reply with the number only.",
    expected: "627",
    rating: 3550,
  }),
  task({
    id: "factorial-digit-sum",
    label: "Factorial digit sum",
    category: "coding",
    prompt: "What is the sum of the decimal digits of 100 factorial? Reply with the number only.",
    expected: "648",
    rating: 3600,
  }),
  task({
    id: "factorial-zeros-inverse",
    label: "Inverse trailing zeros",
    category: "reasoning",
    prompt:
      "What is the smallest positive integer n such that n factorial ends in at least 100 trailing zeros? Reply with the number only.",
    expected: "405",
    rating: 3650,
  }),
];

export function intelligenceRatingBounds(): { min: number; max: number } {
  const ratings = intelligenceRatingTasks.map((item) => item.rating);
  return { min: Math.min(...ratings), max: Math.max(...ratings) };
}

export function expectedPassProbability(taskRating: number, modelRating: number): number {
  return 1 / (1 + 10 ** ((taskRating - modelRating) / INTELLIGENCE_RATING_SCALE));
}

export function computeIntelligenceRating(
  results: Array<{ rating: number; passed: boolean }>
): number {
  const rated = results.filter((item) => Number.isFinite(item.rating) && item.rating > 0);
  if (rated.length === 0) return 0;
  const ratings = rated.map((item) => item.rating);
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const passedCount = rated.filter((item) => item.passed).length;
  if (passedCount === 0) return Math.max(0, minRating - INTELLIGENCE_RATING_EDGE_MARGIN);
  if (passedCount === rated.length) return maxRating + INTELLIGENCE_RATING_EDGE_MARGIN;
  let low = minRating - INTELLIGENCE_RATING_EDGE_MARGIN * 2;
  let high = maxRating + INTELLIGENCE_RATING_EDGE_MARGIN * 2;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    const expected = rated.reduce(
      (total, item) => total + expectedPassProbability(item.rating, middle),
      0
    );
    if (expected < passedCount) low = middle;
    else high = middle;
  }
  return Math.round((low + high) / 2);
}

export function intelligenceRatingTier(rating: number): string {
  if (rating < 1000) return "Emerging";
  if (rating < 1400) return "Developing";
  if (rating < 1800) return "Capable";
  if (rating < 2200) return "Advanced";
  if (rating < 2600) return "Expert";
  if (rating < 3000) return "Frontier";
  return "Superhuman";
}

export function intelligenceRatingManifest(): Record<string, unknown> {
  const bounds = intelligenceRatingBounds();
  return {
    format: "cybara-intelligence-rating-manifest",
    version: 1,
    suiteId: INTELLIGENCE_RATING_SUITE_ID,
    name: "Cybara Intelligence Rating",
    taskCount: intelligenceRatingTasks.length,
    scoring: {
      method: "rasch-elo-mle",
      description:
        "Each task carries a fixed difficulty rating. The model rating is the maximum-likelihood ability under a one-parameter logistic model P(pass) = 1 / (1 + 10^((task - ability) / 400)), solved deterministically by bisection. A perfect run is capped at the hardest task rating plus 400; a zero run at the easiest minus 400.",
      scale: INTELLIGENCE_RATING_SCALE,
      edgeMargin: INTELLIGENCE_RATING_EDGE_MARGIN,
      minTaskRating: bounds.min,
      maxTaskRating: bounds.max,
      tiers: [
        { below: 1000, label: "Emerging" },
        { below: 1400, label: "Developing" },
        { below: 1800, label: "Capable" },
        { below: 2200, label: "Advanced" },
        { below: 2600, label: "Expert" },
        { below: 3000, label: "Frontier" },
        { below: null, label: "Superhuman" },
      ],
    },
    grading: {
      method: "objective-string-match",
      description:
        "Responses are trimmed, then formatting wrappers are stripped to a fixed point: markdown emphasis (**x**, *x*, __x__, ~~x~~), inline and fenced code, headings, quotes, LaTeX $..$, \\boxed{}, \\text{}, \\frac{}{} (to a/b), one trailing sentence period, and thousands separators in integers. The unwrapped answer is compared case-insensitively against the expected value. If both the expected and the answer parse as numbers (integers, decimals, or a/b fractions), they are compared numerically so 2/5 and 0.4 are equal. Extra prose around the answer still fails. Tasks with a required tool additionally verify that the tool was observed. No judge model is used.",
      workspaceFixtures: {
        "benchmark.txt": "ORCHID-742",
        "data.csv": "value\n17\n25\n41\n9\n",
      },
    },
    reproducibility:
      "Run each prompt as an isolated single-turn conversation with tools enabled only for tool_use tasks. Grade with the normalization above and compute the rating with the published formula. Prompts are open by design; treat memorized answers as a known public-benchmark tradeoff.",
    tasks: intelligenceRatingTasks.map((item) => ({
      ...item,
      sha256: createHash("sha256")
        .update(`${item.id}\n${item.prompt}\n${item.expected}`)
        .digest("hex"),
    })),
  };
}

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
    INTELLIGENCE_RATING_SUITE_ID,
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
  const score = computeIntelligenceRating(results);
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

const benchmarkCancelRequests = new Set<string>();

export function requestIntelligenceBenchmarkCancel(id: string): IntelligenceBenchmarkRun | null {
  const row = db
    .prepare("SELECT * FROM agent_benchmark_runs WHERE id = ? AND status = 'running'")
    .get(id) as BenchmarkRunRow | null;
  if (!row) return null;
  benchmarkCancelRequests.add(id);
  return fromRow(row);
}

export function isIntelligenceBenchmarkCancelRequested(id: string): boolean {
  return benchmarkCancelRequests.has(id);
}

export function clearIntelligenceBenchmarkCancelRequest(id: string): void {
  benchmarkCancelRequests.delete(id);
}

export function cancelIntelligenceBenchmarkRun(
  id: string,
  results: IntelligenceBenchmarkResult[]
): IntelligenceBenchmarkRun {
  benchmarkCancelRequests.delete(id);
  const score = computeIntelligenceRating(results);
  db.prepare(
    `UPDATE agent_benchmark_runs SET
      status = 'cancelled', score = ?, current_task = ?, results_json = ?,
      error = 'Cancelled before completion; partial results retained', completed_at = ?
     WHERE id = ?`
  ).run(score, results.length, JSON.stringify(results), new Date().toISOString(), id);
  const row = db
    .prepare("SELECT * FROM agent_benchmark_runs WHERE id = ?")
    .get(id) as BenchmarkRunRow;
  return fromRow(row);
}

export function deleteIntelligenceBenchmarkRun(id: string): boolean {
  const changes = db
    .prepare("DELETE FROM agent_benchmark_runs WHERE id = ? AND status != 'running'")
    .run(id).changes;
  return changes > 0;
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

const ANSWER_UNWRAP_STEPS: Array<[RegExp, string]> = [
  [/^```[a-z]*\n([\s\S]*?)\n?```$/i, "$1"],
  [/^\$\$?([\s\S]+?)\$\$?$/, "$1"],
  [/^\\\[([\s\S]+?)\\\]$/, "$1"],
  [/^\\\(([\s\S]+?)\\\)$/, "$1"],
  [/^\\boxed\{(.+)\}$/s, "$1"],
  [/^\\text\{(.+)\}$/s, "$1"],
  [/^\\mathrm\{(.+)\}$/s, "$1"],
  [/^\\frac\{([^{}]+)\}\{([^{}]+)\}$/s, "$1/$2"],
  [/^\*\*\*(.+)\*\*\*$/s, "$1"],
  [/^\*\*(.+)\*\*$/s, "$1"],
  [/^\*(.+)\*$/s, "$1"],
  [/^__(.+)__$/s, "$1"],
  [/^_(.+)_$/s, "$1"],
  [/^~~(.+)~~$/s, "$1"],
  [/^`(.+)`$/s, "$1"],
  [/^"(.+)"$/s, "$1"],
  [/^'(.+)'$/s, "$1"],
  [/^#{1,6}\s+(.+)$/s, "$1"],
];

export function normalizeBenchmarkAnswer(value: string): string {
  let current = value.trim();
  for (let pass = 0; pass < 12; pass += 1) {
    let next = current;
    for (const [pattern, replacement] of ANSWER_UNWRAP_STEPS) {
      next = next.replace(pattern, replacement).trim();
    }
    if (/^.+[.。]$/s.test(next) && !/\d[.]\d/.test(next.slice(-3))) {
      const withoutPeriod = next.replace(/[.。]$/, "").trim();
      if (withoutPeriod.length > 0) next = withoutPeriod;
    }
    if (next === current) break;
    current = next;
  }
  if (/^-?\d{1,3}(,\d{3})+$/.test(current)) {
    current = current.replace(/,/g, "");
  }
  return current;
}

function parseNumericAnswer(value: string): number | null {
  const trimmed = value.trim();
  const fraction = trimmed.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed) || /^-?\.\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function benchmarkAnswerMatches(expected: string, response: string): boolean {
  const normalized = normalizeBenchmarkAnswer(response);
  if (normalized.toLowerCase() === expected.toLowerCase()) return true;
  const expectedNumber = parseNumericAnswer(expected);
  const responseNumber = parseNumericAnswer(normalized);
  if (expectedNumber !== null && responseNumber !== null) {
    return (
      Math.abs(expectedNumber - responseNumber) <= 1e-9 * Math.max(1, Math.abs(expectedNumber))
    );
  }
  return false;
}

export function gradeIntelligenceBenchmarkTask(
  task: IntelligenceBenchmarkTask,
  response: string,
  toolCalls: string[]
): boolean {
  const answerMatches = benchmarkAnswerMatches(task.expected, response);
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
  const answerMatches = benchmarkAnswerMatches(task.expected, response);
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
