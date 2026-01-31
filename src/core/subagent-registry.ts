// Subagent Registry - OpenClaw compatible tracking of spawned subagent runs
import { randomUUID } from "crypto";

export interface SubagentRun {
    runId: string;
    childSessionKey: string;
    requesterSessionKey: string;
    requesterDisplayKey?: string;
    requesterOrigin?: {
        channel?: string;
        to?: string;
        accountId?: string;
    };
    task: string;
    cleanup: "keep" | "delete";
    label?: string;
    runTimeoutSeconds?: number;
    createdAt: number;
    status: "pending" | "running" | "completed" | "failed" | "timeout";
    result?: string;
    error?: string;
    completedAt?: number;
}

// In-memory registry of active subagent runs
const activeRuns = new Map<string, SubagentRun>();

// Timeout timers for runs
const runTimers = new Map<string, Timer>();

/**
 * Register a new subagent run.
 */
export function registerSubagentRun(params: {
    runId?: string;
    childSessionKey: string;
    requesterSessionKey: string;
    requesterOrigin?: SubagentRun["requesterOrigin"];
    requesterDisplayKey?: string;
    task: string;
    cleanup?: "keep" | "delete";
    label?: string;
    runTimeoutSeconds?: number;
}): SubagentRun {
    const runId = params.runId || randomUUID();

    const run: SubagentRun = {
        runId,
        childSessionKey: params.childSessionKey,
        requesterSessionKey: params.requesterSessionKey,
        requesterDisplayKey: params.requesterDisplayKey,
        requesterOrigin: params.requesterOrigin,
        task: params.task,
        cleanup: params.cleanup || "keep",
        label: params.label,
        runTimeoutSeconds: params.runTimeoutSeconds,
        createdAt: Date.now(),
        status: "pending",
    };

    activeRuns.set(runId, run);

    // Set timeout if specified
    if (params.runTimeoutSeconds && params.runTimeoutSeconds > 0) {
        const timer = setTimeout(() => {
            const existingRun = activeRuns.get(runId);
            if (existingRun && existingRun.status === "running") {
                existingRun.status = "timeout";
                existingRun.error = `Run timed out after ${params.runTimeoutSeconds} seconds`;
                existingRun.completedAt = Date.now();
                console.log(`[Subagent] Run ${runId} timed out`);
            }
            runTimers.delete(runId);
        }, params.runTimeoutSeconds * 1000);

        runTimers.set(runId, timer);
    }

    console.log(`[Subagent] Registered run ${runId} for child session ${params.childSessionKey}`);

    return run;
}

/**
 * Mark a run as started (running).
 */
export function markRunStarted(runId: string): boolean {
    const run = activeRuns.get(runId);
    if (!run) return false;

    run.status = "running";
    return true;
}

/**
 * Mark a run as completed with a result.
 */
export function markRunCompleted(runId: string, result: string): boolean {
    const run = activeRuns.get(runId);
    if (!run) return false;

    run.status = "completed";
    run.result = result;
    run.completedAt = Date.now();

    // Clear timeout timer
    const timer = runTimers.get(runId);
    if (timer) {
        clearTimeout(timer);
        runTimers.delete(runId);
    }

    console.log(`[Subagent] Run ${runId} completed`);

    // Clean up if policy is "delete"
    if (run.cleanup === "delete") {
        setTimeout(() => {
            activeRuns.delete(runId);
            console.log(`[Subagent] Run ${runId} cleaned up (delete policy)`);
        }, 5000); // Allow some time for result retrieval
    }

    return true;
}

/**
 * Mark a run as failed with an error.
 */
export function markRunFailed(runId: string, error: string): boolean {
    const run = activeRuns.get(runId);
    if (!run) return false;

    run.status = "failed";
    run.error = error;
    run.completedAt = Date.now();

    // Clear timeout timer
    const timer = runTimers.get(runId);
    if (timer) {
        clearTimeout(timer);
        runTimers.delete(runId);
    }

    console.log(`[Subagent] Run ${runId} failed: ${error}`);

    return true;
}

/**
 * Get a run by ID.
 */
export function getRun(runId: string): SubagentRun | undefined {
    return activeRuns.get(runId);
}

/**
 * Get a run by child session key.
 */
export function getRunBySessionKey(childSessionKey: string): SubagentRun | undefined {
    for (const run of activeRuns.values()) {
        if (run.childSessionKey === childSessionKey) {
            return run;
        }
    }
    return undefined;
}

/**
 * Get all runs for a requester session.
 */
export function getRunsByRequester(requesterSessionKey: string): SubagentRun[] {
    const runs: SubagentRun[] = [];
    for (const run of activeRuns.values()) {
        if (run.requesterSessionKey === requesterSessionKey) {
            runs.push(run);
        }
    }
    return runs;
}

/**
 * Get all active runs.
 */
export function listActiveRuns(): SubagentRun[] {
    return Array.from(activeRuns.values()).filter(
        (run) => run.status === "pending" || run.status === "running"
    );
}

/**
 * Get all runs (including completed).
 */
export function listAllRuns(): SubagentRun[] {
    return Array.from(activeRuns.values());
}

/**
 * Clean up old completed runs (older than maxAgeMs).
 */
export function cleanupOldRuns(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [runId, run] of activeRuns.entries()) {
        if (run.completedAt && now - run.completedAt > maxAgeMs) {
            activeRuns.delete(runId);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`[Subagent] Cleaned up ${cleaned} old runs`);
    }

    return cleaned;
}

/**
 * Check if a session key is a subagent session.
 */
export function isSubagentSessionKey(sessionKey: string): boolean {
    // OpenClaw format: agent:ID:subagent:UUID
    return sessionKey.includes(":subagent:") || sessionKey.startsWith("subagent:");
}

/**
 * Parse a session key to extract agent ID.
 */
export function parseAgentSessionKey(sessionKey: string): { agentId?: string; isSubagent: boolean } {
    // Format: agent:AGENT_ID:subagent:UUID or agent:AGENT_ID
    const parts = sessionKey.split(":");

    if (parts.length >= 2 && parts[0] === "agent") {
        return {
            agentId: parts[1],
            isSubagent: parts.length >= 4 && parts[2] === "subagent",
        };
    }

    return { isSubagent: isSubagentSessionKey(sessionKey) };
}

/**
 * Generate a new subagent session key.
 */
export function generateSubagentSessionKey(agentId: string = "default"): string {
    return `agent:${agentId}:subagent:${randomUUID()}`;
}
