// Centralized metrics tracking for the Cybara Agent Platform
// Consolidates all metric tracking functions

import { tables } from "./database";

/**
 * Track a generic metric
 */
export function trackMetric(
    type: string,
    key: string,
    value: number,
    metadata?: Record<string, unknown>
): void {
    try {
        const id = crypto.randomUUID();
        tables.metrics.add({
            id,
            type,
            key,
            value,
            metadata: metadata ? JSON.stringify(metadata) : undefined,
        });
    } catch {
        // Silent fail - metrics shouldn't break execution
    }
}

/**
 * Track a tool call
 */
export function trackToolCall(
    toolName: string,
    duration: number,
    success: boolean
): void {
    try {
        const id = crypto.randomUUID();

        // Track by tool name
        tables.metrics.add({ id, type: "tool_call", key: toolName, value: 1 });

        // Also track with 'all' for easier aggregation
        const allId = crypto.randomUUID();
        tables.metrics.add({ id: allId, type: "tool_call", key: "all", value: 1 });

        // Track duration
        if (duration > 0) {
            const durationId = crypto.randomUUID();
            tables.metrics.add({
                id: durationId,
                type: "tool_duration",
                key: toolName,
                value: duration,
            });
        }

        // Track errors
        if (!success) {
            const errId = crypto.randomUUID();
            tables.metrics.add({ id: errId, type: "tool_error", key: toolName, value: 1 });
        }
    } catch {
        // Silent fail - metrics shouldn't break execution
    }
}

/**
 * Track token usage for LLM calls
 */
export function trackTokenUsage(
    model: string,
    provider: string,
    inputTokens: number,
    outputTokens: number
): void {
    try {
        const totalTokens = inputTokens + outputTokens;

        // Track total
        const totalId = crypto.randomUUID();
        tables.metrics.add({
            id: totalId,
            type: "token_usage",
            key: "all",
            value: totalTokens,
        });

        // Track input/output separately
        const inputId = crypto.randomUUID();
        tables.metrics.add({
            id: inputId,
            type: "token_usage",
            key: "input",
            value: inputTokens,
        });

        const outputId = crypto.randomUUID();
        tables.metrics.add({
            id: outputId,
            type: "token_usage",
            key: "output",
            value: outputTokens,
        });

        // Track by model
        const modelId = crypto.randomUUID();
        tables.metrics.add({
            id: modelId,
            type: "token_usage",
            key: model,
            value: totalTokens,
        });

        // Track by provider
        const providerId = crypto.randomUUID();
        tables.metrics.add({
            id: providerId,
            type: "token_usage",
            key: provider,
            value: totalTokens,
        });
    } catch {
        // Silent fail
    }
}

/**
 * Track API call metrics
 */
export function trackApiCall(
    endpoint: string,
    method: string,
    status: number,
    durationMs: number
): void {
    try {
        const id = crypto.randomUUID();
        const success = status >= 200 && status < 400;

        tables.metrics.add({
            id,
            type: "api_call",
            key: success ? "success" : "error",
            value: 1,
        });

        // Track by endpoint
        const endpointId = crypto.randomUUID();
        tables.metrics.add({
            id: endpointId,
            type: "api_endpoint",
            key: `${method} ${endpoint}`,
            value: durationMs,
        });
    } catch {
        // Silent fail
    }
}

/**
 * Track file operations
 */
export function trackFileOperation(
    operation: "read" | "write" | "edit" | "search",
    path: string,
    metadata?: Record<string, unknown>
): void {
    trackMetric("file_operation", operation, 1, { path, ...metadata });
    trackMetric(`file_${operation}`, path, 1);
}
