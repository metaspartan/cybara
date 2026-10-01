import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  BENCHMARK_LIMITS,
  BenchmarkConfigError,
  buildReport,
  buildRunPlan,
  createProxyCollector,
  measureRequestShape,
  uncachedPromptTokens,
  isGatewayFailureBody,
  type RequestShape,
  formatReportLines,
  isSafeRelativePath,
  parseBenchmarkConfig,
  readUsage,
  resolveWithinRoot,
  resolveUpstreamUrl,
  scoreAssertions,
  serializeCompletionSse,
  substituteTemplate,
  sumUsages,
  type BenchmarkConfig,
  type CompletionShape,
  type BenchmarkTask,
  type CommandHarnessSpec,
  type GatewayHarnessSpec,
  type HarnessSpec,
  type PlannedRun,
  type ProxyRequestRecord,
  type RunMetrics,
  type RunStatus,
  type TokenUsage,
  type UsageAggregate,
} from "./harness-benchmark-core";

const INTERCEPT_PATH = "/v1/chat/completions";
const RUN_ENV = {
  workspace: "HARNESS_BENCH_WORKSPACE",
  prompt: "HARNESS_BENCH_PROMPT_FILE",
  model: "HARNESS_BENCH_MODEL",
  proxy: "HARNESS_BENCH_PROXY_URL",
  keyEnv: "HARNESS_BENCH_PROVIDER_KEY_ENV",
  runId: "HARNESS_BENCH_RUN_ID",
} as const;

interface CliOptions {
  configPath: string;
  dryRun: boolean;
  outDir: string | null;
  rounds: number | null;
  seed: number;
}

interface ProxyRuntime {
  url: string;
  finishRun: (runId: string) => Promise<void>;
  stop: () => void;
}

interface ExecOutcome {
  status: RunStatus;
  exitCode: number | null;
  elapsedMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  error: string | null;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let configPath: string | null = null;
  let dryRun = false;
  let outDir: string | null = null;
  let rounds: number | null = null;
  let seed = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new BenchmarkConfigError(`${String(arg)} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--config") configPath = next();
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--out") outDir = next();
    else if (arg === "--rounds") rounds = Number.parseInt(next(), 10);
    else if (arg === "--seed") seed = Number.parseInt(next(), 10);
    else if (arg === "--help" || arg === "-h")
      throw new BenchmarkConfigError(
        "usage: --config <path> [--dry-run] [--out <dir>] [--rounds <n>] [--seed <n>]"
      );
    else throw new BenchmarkConfigError(`unknown argument ${String(arg)}`);
  }
  if (configPath === null) throw new BenchmarkConfigError("--config <path> is required");
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < 1))
    throw new BenchmarkConfigError("--rounds must be a positive integer");
  if (!Number.isInteger(seed)) throw new BenchmarkConfigError("--seed must be an integer");
  return { configPath, dryRun, outDir, rounds, seed };
}

async function readConfigFile(configPath: string): Promise<unknown> {
  const file = Bun.file(resolve(configPath));
  if (!(await file.exists())) throw new BenchmarkConfigError(`config not found: ${configPath}`);
  if (file.size > BENCHMARK_LIMITS.config_bytes) {
    throw new BenchmarkConfigError(`config exceeds ${BENCHMARK_LIMITS.config_bytes} bytes`);
  }
  return file.json();
}

function nowIso(): string {
  return new Date().toISOString();
}

function providerKey(config: BenchmarkConfig): string {
  const key = process.env[config.provider_key_env];
  if (typeof key !== "string" || key.length === 0) {
    throw new BenchmarkConfigError(`environment variable ${config.provider_key_env} is not set`);
  }
  return key;
}

function completionFromRaw(raw: unknown): CompletionShape | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.model !== "string" ||
    !Array.isArray(value.choices)
  )
    return null;
  const choices: CompletionShape["choices"] = [];
  for (const entry of value.choices) {
    if (!entry || typeof entry !== "object") return null;
    const choice = entry as Record<string, unknown>;
    if (!choice.message || typeof choice.message !== "object") return null;
    const message = choice.message as Record<string, unknown>;
    if (
      typeof message.role !== "string" ||
      (message.content !== null &&
        message.content !== undefined &&
        typeof message.content !== "string")
    )
      return null;
    const calls: NonNullable<CompletionShape["choices"][number]["message"]["tool_calls"]> = [];
    if (message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls)) return null;
      for (const call of message.tool_calls) {
        if (!call || typeof call !== "object") return null;
        const tool = call as Record<string, unknown>;
        if (typeof tool.id !== "string" || !tool.function || typeof tool.function !== "object")
          return null;
        const fn = tool.function as Record<string, unknown>;
        if (typeof fn.name !== "string" || typeof fn.arguments !== "string") return null;
        calls.push({
          id: tool.id,
          type: "function",
          function: { name: fn.name, arguments: fn.arguments },
        });
      }
    }
    choices.push({
      index: typeof choice.index === "number" ? choice.index : choices.length,
      message: {
        role: message.role,
        content: typeof message.content === "string" ? message.content : null,
        ...(calls.length ? { tool_calls: calls } : {}),
      },
      finish_reason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
    });
  }
  return {
    id: value.id,
    object: typeof value.object === "string" ? value.object : "chat.completion",
    created: typeof value.created === "number" ? value.created : 0,
    model: value.model,
    choices,
    ...(value.usage !== undefined ? { usage: value.usage } : {}),
  };
}

function errorBody(message: string, type: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message, type, code: status } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function startProxy(
  config: BenchmarkConfig,
  collector: ReturnType<typeof createProxyCollector>
): Promise<ProxyRuntime> {
  const upstreamUrl = resolveUpstreamUrl(config.provider_url);
  const apiKey = providerKey(config);
  let counter = 0;
  const activeRequests = new Map<string, Set<AbortController>>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const scopedPath = /^\/run\/([^/]+)\/v1\/chat\/completions$/.exec(url.pathname);
      if (!scopedPath && url.pathname !== INTERCEPT_PATH)
        return errorBody("not intercepted", "not_found", 404);
      const requestRunId = scopedPath?.[1] ?? collector.activeRunId();
      if (!requestRunId || collector.activeRunId() !== requestRunId)
        return errorBody("run is no longer active", "inactive_run", 409);
      if (request.method !== "POST") return errorBody("method not allowed", "invalid_request", 405);
      if (collector.activeRunId() === null) return errorBody("no active run", "no_active_run", 409);
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return errorBody("invalid json body", "invalid_request", 400);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return errorBody("invalid json body", "invalid_request", 400);
      const body = payload as Record<string, unknown>;
      const model = typeof body.model === "string" ? body.model : "";
      if (model !== config.model) {
        return errorBody("model is not permitted for this benchmark", "model_not_allowed", 400);
      }
      const requestedStream = body.stream === true;
      const forwarded: Record<string, unknown> = { ...body, stream: false };
      delete forwarded.stream_options;
      const shape = measureRequestShape(body);
      const startedAt = Date.now();
      const upstreamStartedAt = startedAt;
      counter += 1;
      const index = counter;
      let response: Response;
      const controller = new AbortController();
      const controllers = activeRequests.get(requestRunId) ?? new Set<AbortController>();
      controllers.add(controller);
      activeRequests.set(requestRunId, controllers);
      try {
        response = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(forwarded),
          signal: AbortSignal.any([controller.signal, request.signal, AbortSignal.timeout(60_000)]),
        });
      } catch (error) {
        controllers.delete(controller);
        const record = buildRecord(
          index,
          startedAt,
          502,
          false,
          model,
          requestedStream,
          0,
          null,
          shape,
          Date.now() - upstreamStartedAt
        );
        collector.record(record, requestRunId);
        return errorBody(
          error instanceof Error ? error.name : "upstream_failure",
          "upstream_failure",
          502
        );
      }
      let responseText: string;
      try {
        responseText = await response.text();
      } finally {
        controllers.delete(controller);
      }
      const responseBytes = new TextEncoder().encode(responseText).length;
      const upstreamMs = Date.now() - upstreamStartedAt;
      if (!response.ok) {
        const record = buildRecord(
          index,
          startedAt,
          response.status,
          false,
          model,
          requestedStream,
          responseBytes,
          null,
          shape,
          upstreamMs
        );
        collector.record(record, requestRunId);
        return new Response(responseText, {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        const record = buildRecord(
          index,
          startedAt,
          502,
          false,
          model,
          requestedStream,
          responseBytes,
          null,
          shape,
          upstreamMs
        );
        collector.record(record, requestRunId);
        return errorBody("upstream returned invalid json", "upstream_invalid", 502);
      }
      const completion = completionFromRaw(parsed);
      const usage: TokenUsage | null = completion ? readUsage(completion.usage) : null;
      const record = buildRecord(
        index,
        startedAt,
        200,
        true,
        model,
        requestedStream,
        responseBytes,
        usage,
        shape,
        upstreamMs
      );
      collector.record(record, requestRunId);
      if (!requestedStream) {
        return new Response(responseText, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (completion === null)
        return errorBody("upstream returned invalid json", "upstream_invalid", 502);
      const sse = serializeCompletionSse(completion);
      return new Response(sse, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    finishRun: async (runId: string): Promise<void> => {
      const controllers = activeRequests.get(runId);
      for (const controller of controllers ?? []) controller.abort();
      for (let attempt = 0; attempt < 100 && (controllers?.size ?? 0) > 0; attempt += 1)
        await Bun.sleep(10);
      activeRequests.delete(runId);
    },
    stop: (): void => {
      server.stop(true);
    },
  };
}

function buildRecord(
  index: number,
  startedAt: number,
  status: number,
  success: boolean,
  model: string,
  requestedStream: boolean,
  responseBytes: number,
  usage: TokenUsage | null,
  shape: RequestShape,
  upstreamMs: number | null
): ProxyRequestRecord {
  const endedAt = Date.now();
  return {
    index,
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    latency_ms: endedAt - startedAt,
    status,
    success,
    model,
    requested_stream: requestedStream,
    response_bytes: responseBytes,
    usage,
    ...shape,
    upstream_ms: upstreamMs,
    uncached_tokens: uncachedPromptTokens(usage),
  };
}

function makeCancellableDelay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((res) => {
    handle = setTimeout(res, ms);
  });
  return {
    promise,
    cancel: (): void => {
      if (handle !== undefined) clearTimeout(handle);
    },
  };
}

async function terminateProcessTree(pid: number | undefined, kill: () => void): Promise<void> {
  if (pid === undefined) {
    kill();
    return;
  }
  if (process.platform === "win32") {
    const killer = Bun.spawnSync({
      cmd: ["taskkill", "/pid", String(pid), "/T", "/F"],
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    if (killer.exitCode === 0) return;
  }
  kill();
}

async function countBytes(stream: ReadableStream<Uint8Array> | null): Promise<number> {
  if (stream === null) return 0;
  return (await new Response(stream).arrayBuffer()).byteLength;
}

async function runCommandHarness(
  harness: CommandHarnessSpec,
  task: BenchmarkTask,
  workspace: string,
  promptFile: string,
  config: BenchmarkConfig,
  proxyUrl: string
): Promise<ExecOutcome> {
  const values = { workspace, prompt_file: promptFile, model: config.model, proxy_url: proxyUrl };
  const command = harness.command.map((arg) => substituteTemplate(arg, values));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("=")) env[key] = value;
  }
  for (const [key, value] of Object.entries(harness.env))
    env[key] = substituteTemplate(value, values);
  env[RUN_ENV.workspace] = workspace;
  env[RUN_ENV.prompt] = promptFile;
  env[RUN_ENV.model] = config.model;
  env[RUN_ENV.proxy] = proxyUrl;
  env[RUN_ENV.keyEnv] = config.provider_key_env;
  delete env[config.provider_key_env];
  const startedAt = Date.now();
  const proc = Bun.spawn({
    cmd: command,
    cwd: harness.cwd_mode === "workspace" ? workspace : process.cwd(),
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutBytes = countBytes(proc.stdout as ReadableStream<Uint8Array>);
  const stderrBytes = countBytes(proc.stderr as ReadableStream<Uint8Array>);
  const delay = makeCancellableDelay(harness.timeout_ms);
  const outcome = await Promise.race([
    proc.exited.then((code) => ({ type: "exited" as const, code })),
    delay.promise.then(() => ({ type: "timeout" as const, code: null })),
  ]);
  delay.cancel();
  if (outcome.type === "timeout") {
    await terminateProcessTree(proc.pid, () => proc.kill());
    await Promise.allSettled([stdoutBytes, stderrBytes]);
    return {
      status: "timeout",
      exitCode: null,
      elapsedMs: Date.now() - startedAt,
      stdoutBytes: 0,
      stderrBytes: 0,
      error: `timeout after ${harness.timeout_ms}ms`,
    };
  }
  const [outBytes, errBytes] = await Promise.all([stdoutBytes, stderrBytes]);
  return {
    status: outcome.code === 0 ? "ok" : "error",
    exitCode: outcome.code,
    elapsedMs: Date.now() - startedAt,
    stdoutBytes: outBytes,
    stderrBytes: errBytes,
    error: outcome.code === 0 ? null : `exit code ${String(outcome.code)}`,
  };
}

async function stopGatewaySession(
  harness: GatewayHarnessSpec,
  sessionId: string,
  apiKey: string
): Promise<void> {
  try {
    await fetch(
      `${harness.url.replace(/\/+$/, "")}/api/chat/sessions/${encodeURIComponent(sessionId)}/stop`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    return;
  }
}

async function runGatewayHarness(
  harness: GatewayHarnessSpec,
  task: BenchmarkTask,
  workspace: string,
  promptFile: string,
  config: BenchmarkConfig,
  runId: string
): Promise<ExecOutcome> {
  const apiKey = process.env[harness.api_key_env];
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return {
      status: "error",
      exitCode: null,
      elapsedMs: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      error: `environment variable ${harness.api_key_env} is not set`,
    };
  }
  const sessionId = `harness-bench-${runId}`;
  const base = harness.url.replace(/\/+$/, "");
  const startedAt = Date.now();
  const controller = new AbortController();
  const delay = makeCancellableDelay(harness.timeout_ms);
  void delay.promise.then(() => controller.abort());
  try {
    const prompt = substituteTemplate(task.prompt, {
      workspace,
      prompt_file: promptFile,
      model: config.model,
      proxy_url: "",
    });
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        agentId: harness.agent_id,
        sessionId,
        message: prompt,
        workspaceDir: workspace,
        tools: true,
        persist: true,
        channel: "api",
        stream: false,
        modelOverride: config.model,
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    const responseBytes = new TextEncoder().encode(body).length;
    let invalidBody = false;
    try {
      invalidBody = isGatewayFailureBody(JSON.parse(body));
    } catch {
      invalidBody = true;
    }
    return {
      status: response.ok && !invalidBody ? "ok" : "error",
      exitCode: response.ok && !invalidBody ? 0 : response.ok ? 1 : response.status,
      elapsedMs: Date.now() - startedAt,
      stdoutBytes: responseBytes,
      stderrBytes: 0,
      error: !response.ok
        ? `gateway status ${String(response.status)}`
        : invalidBody
          ? "gateway_failure"
          : null,
    };
  } catch (error) {
    const aborted = controller.signal.aborted;
    if (aborted) await stopGatewaySession(harness, sessionId, apiKey);
    return {
      status: aborted ? "timeout" : "error",
      exitCode: null,
      elapsedMs: Date.now() - startedAt,
      stdoutBytes: 0,
      stderrBytes: 0,
      error: aborted
        ? `timeout after ${harness.timeout_ms}ms`
        : error instanceof Error
          ? error.name
          : "gateway_failure",
    };
  } finally {
    delay.cancel();
  }
}

function materializeFixture(
  task: BenchmarkTask,
  runDir: string
): { workspace: string; promptFile: string } {
  const workspace = join(runDir, "workspace");
  if (existsSync(runDir))
    throw new BenchmarkConfigError("Choose a fresh output directory; this run already exists.");
  mkdirSync(workspace, { recursive: true });
  for (const file of task.files) {
    if (!isSafeRelativePath(file.path))
      throw new BenchmarkConfigError(`task ${task.id} has an unsafe file path`);
    const resolved = resolveWithinRoot(workspace, file.path);
    if (resolved === null)
      throw new BenchmarkConfigError(`task ${task.id} file path escapes workspace`);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, file.content, "utf8");
  }
  const promptFile = join(runDir, "prompt.txt");
  mkdirSync(dirname(promptFile), { recursive: true });
  writeFileSync(promptFile, task.prompt, "utf8");
  return { workspace, promptFile };
}

function findHarness(config: BenchmarkConfig, harnessId: string): HarnessSpec {
  const harness = config.harnesses.find((entry) => entry.id === harnessId);
  if (!harness) throw new BenchmarkConfigError(`unknown harness ${harnessId}`);
  return harness;
}

function findTask(config: BenchmarkConfig, taskId: string): BenchmarkTask {
  const task = config.tasks.find((entry) => entry.id === taskId);
  if (!task) throw new BenchmarkConfigError(`unknown task ${taskId}`);
  return task;
}

async function executeRun(
  config: BenchmarkConfig,
  planned: PlannedRun,
  outputRoot: string,
  proxyUrl: string,
  collector: ReturnType<typeof createProxyCollector>,
  finishRun: (runId: string) => Promise<void>
): Promise<RunMetrics> {
  const task = findTask(config, planned.task_id);
  const harness = findHarness(config, planned.harness_id);
  const runDir = join(outputRoot, "runs", planned.run_id);
  const { workspace, promptFile } = materializeFixture(task, runDir);
  collector.beginRun(planned.run_id);
  const startedAt = nowIso();
  let outcome: ExecOutcome;
  try {
    outcome =
      harness.kind === "command"
        ? await runCommandHarness(harness, task, workspace, promptFile, config, proxyUrl)
        : await runGatewayHarness(harness, task, workspace, promptFile, config, planned.run_id);
  } catch (error) {
    outcome = {
      status: "error",
      exitCode: null,
      elapsedMs: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      error: error instanceof Error ? error.name : "harness_failure",
    };
  }
  await finishRun(planned.run_id);
  const requests = collector.endRun(planned.run_id);
  const assertions = scoreAssertions(workspace, task.assertions);
  const passed = assertions.filter((assertion) => assertion.passed).length;
  const usage: UsageAggregate = sumUsages(requests.map((request) => request.usage));
  return {
    run_id: planned.run_id,
    round: planned.round,
    sequence: planned.sequence,
    task_id: planned.task_id,
    harness_id: planned.harness_id,
    harness_kind: planned.harness_kind,
    status: outcome.status,
    started_at: startedAt,
    ended_at: nowIso(),
    elapsed_ms: outcome.elapsedMs,
    exit_code: outcome.exitCode,
    proxy_url: proxyUrl,
    requests,
    usage,
    assertions,
    passed,
    total: assertions.length,
    all_passed: outcome.status === "ok" && passed === assertions.length,
    stdout_bytes: outcome.stdoutBytes,
    stderr_bytes: outcome.stderrBytes,
    error: outcome.error,
  };
}

function writeRunMetrics(outputRoot: string, run: RunMetrics): void {
  const metricsDir = join(outputRoot, "metrics");
  mkdirSync(metricsDir, { recursive: true });
  writeFileSync(
    join(metricsDir, `${run.run_id}.json`),
    `${JSON.stringify(run, null, 2)}\n`,
    "utf8"
  );
}

function printPlan(plan: readonly PlannedRun[]): void {
  for (const run of plan) {
    console.log(
      `#${run.sequence} round=${run.round} ${run.harness_kind} ${run.harness_id} task=${run.task_id} run=${run.run_id}`
    );
  }
}

async function main(): Promise<number> {
  const options = parseCliOptions(process.argv.slice(2));
  const raw = await readConfigFile(options.configPath);
  const config = parseBenchmarkConfig(raw);
  if (options.rounds !== null) config.rounds = options.rounds;
  if (
    options.rounds !== null &&
    config.rounds * config.tasks.length * config.harnesses.length > BENCHMARK_LIMITS.runs
  ) {
    throw new BenchmarkConfigError(`plan exceeds the ${BENCHMARK_LIMITS.runs} run budget`);
  }
  const plan = buildRunPlan(config, options.seed);
  const outputRoot = isAbsolute(options.outDir ?? config.output_dir)
    ? (options.outDir ?? config.output_dir)
    : resolve(process.cwd(), options.outDir ?? config.output_dir);
  if (options.dryRun) {
    console.log(
      `dry-run model=${config.model} rounds=${config.rounds} runs=${plan.length} output=${outputRoot}`
    );
    printPlan(plan);
    return 0;
  }
  mkdirSync(outputRoot, { recursive: true });
  const collector = createProxyCollector();
  const proxy = await startProxy(config, collector);
  const runs: RunMetrics[] = [];
  try {
    for (const planned of plan) {
      const runProxyUrl = proxy.url.replace(/\/v1$/, `/run/${planned.run_id}/v1`);
      const run = await executeRun(
        config,
        planned,
        outputRoot,
        runProxyUrl,
        collector,
        proxy.finishRun
      );
      runs.push(run);
      writeRunMetrics(outputRoot, run);
      console.log(
        `run=${run.run_id} status=${run.status} elapsed_ms=${run.elapsed_ms} passed=${run.passed}/${run.total} requests=${run.requests.length} prompt_tokens=${run.usage.prompt_tokens ?? "null"} completion_tokens=${run.usage.completion_tokens ?? "null"}`
      );
    }
  } finally {
    proxy.stop();
  }
  const report = buildReport(config, plan, runs, options.seed, nowIso());
  writeFileSync(join(outputRoot, "result.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  for (const line of formatReportLines(report)) console.log(line);
  console.log(`result=${join(outputRoot, "result.json")}`);
  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(
        error instanceof BenchmarkConfigError
          ? `config error: ${error.message}`
          : `runner error: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    });
}
