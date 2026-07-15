import type { AgentMessage } from "../agent";
import type { Provider } from "../database";
import { commandExists } from "../platform";
import { readDevinProviderSettings } from "../provider-settings";
import type { ToolContext } from "../tools";

export interface AgentProviderTransportResult {
  content: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CursorTransportDependencies {
  commandAvailable: (command: string) => boolean;
  run: (
    command: string[],
    options: { cwd?: string; env: Record<string, string | undefined>; signal?: AbortSignal }
  ) => Promise<ProcessResult>;
}

interface DevinTransportDependencies {
  fetch: typeof fetch;
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const defaultCursorDependencies: CursorTransportDependencies = {
  commandAvailable: commandExists,
  run: async (command, options) => {
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: options.signal,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  },
};

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function providerCredential(provider: Provider): string {
  const credential = provider.api_key || provider.access_token;
  if (!credential) throw new Error(`No credential available for ${provider.provider}`);
  return credential;
}

function transportPrompt(messages: AgentMessage[]): string {
  return messages
    .filter((message) => message.role !== "tool" || message.content.trim())
    .map((message) => `${message.role.toUpperCase()}\n${message.content.trim()}`)
    .join("\n\n")
    .trim();
}

function normalizedBaseUrl(provider: Provider, fallback: string): string {
  return (provider.base_url || fallback).replace(/\/+$/, "");
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.text()).trim().slice(0, 1_000);
  return new Error(`Provider rejected the request (${response.status})${body ? `: ${body}` : ""}`);
}

export async function callCursorAgentTransport(
  provider: Provider,
  model: string,
  messages: AgentMessage[],
  context?: ToolContext,
  dependencies: CursorTransportDependencies = defaultCursorDependencies
): Promise<AgentProviderTransportResult> {
  if (!dependencies.commandAvailable("cursor-agent")) {
    throw new Error("Cursor CLI is not installed or cursor-agent is not available in PATH");
  }
  if (messages.some((message) => (message.images?.length ?? 0) > 0)) {
    throw new Error("Cursor CLI transport does not support image attachments");
  }
  const credential = providerCredential(provider);
  const command = ["cursor-agent", "-p", transportPrompt(messages), "--output-format", "text"];
  if (model && model !== "default") command.push("--model", model);
  const result = await dependencies.run(command, {
    cwd: context?.workspaceDir,
    env: { ...process.env, CURSOR_API_KEY: credential },
    signal: context?.abortSignal,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Cursor CLI exited with code ${result.exitCode}${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 1_000)}` : ""}`
    );
  }
  const content = result.stdout.trim();
  if (!content) throw new Error("Cursor CLI returned an empty response");
  return { content };
}

export async function callGitLabDuoTransport(
  provider: Provider,
  messages: AgentMessage[],
  context?: ToolContext
): Promise<AgentProviderTransportResult> {
  const credential = providerCredential(provider);
  const response = await fetch(
    `${normalizedBaseUrl(provider, "https://gitlab.com")}/api/v4/chat/completions`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: transportPrompt(messages), with_clean_history: true }),
      signal: context?.abortSignal,
    }
  );
  if (!response.ok) throw await responseError(response);
  const payload = (await response.json()) as unknown;
  const direct = textValue(payload);
  const record = objectRecord(payload);
  const content =
    direct ||
    textValue(record?.content) ||
    textValue(objectRecord(record?.message)?.content) ||
    textValue(objectRecord(record?.choices)?.text);
  if (!content) throw new Error("GitLab Duo returned an invalid response");
  return { content };
}

function devinSessionId(payload: unknown): string | undefined {
  const record = objectRecord(payload);
  return textValue(record?.session_id) || textValue(record?.devin_id) || textValue(record?.id);
}

function devinTerminalStatus(payload: unknown): "complete" | "error" | "pending" {
  const record = objectRecord(payload);
  const value = (
    textValue(record?.status_enum) ||
    textValue(record?.status) ||
    textValue(objectRecord(record?.status_detail)?.status)
  )?.toLowerCase();
  if (!value) return "pending";
  if (["finished", "completed", "complete", "stopped"].includes(value)) return "complete";
  if (["error", "failed", "cancelled", "canceled", "expired"].includes(value)) return "error";
  return "pending";
}

function devinMessageContent(payload: unknown): string | undefined {
  const record = objectRecord(payload);
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.messages)
      ? record.messages
      : [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const message = objectRecord(values[index]);
    if (!message) continue;
    const source = textValue(message.source)?.toLowerCase();
    const role = textValue(message.role)?.toLowerCase();
    if (source && source !== "devin" && role !== "assistant") continue;
    const content =
      textValue(message.message) || textValue(message.content) || textValue(message.text);
    if (content) return content;
  }
  return undefined;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const complete = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(complete, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

const defaultDevinDependencies: DevinTransportDependencies = { fetch, wait };

export async function callDevinAgentTransport(
  provider: Provider,
  messages: AgentMessage[],
  context?: ToolContext,
  dependencies: DevinTransportDependencies = defaultDevinDependencies
): Promise<AgentProviderTransportResult> {
  const settings = readDevinProviderSettings(provider.settings);
  if (!settings) {
    throw new Error("Devin requires an organization ID and a service-user API key");
  }
  const credential = providerCredential(provider);
  const baseUrl = normalizedBaseUrl(provider, "https://api.devin.ai");
  const sessionRoot = `${baseUrl}/v3/organizations/${encodeURIComponent(settings.organizationId)}/sessions`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credential}`,
    "Content-Type": "application/json",
  };
  const created = await dependencies.fetch(sessionRoot, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: transportPrompt(messages) }),
    signal: context?.abortSignal,
  });
  if (!created.ok) throw await responseError(created);
  const createdPayload = (await created.json()) as unknown;
  const sessionId = devinSessionId(createdPayload);
  if (!sessionId) throw new Error("Devin did not return a session ID");
  const sessionUrl = `${sessionRoot}/${encodeURIComponent(sessionId)}`;
  const deadline = Date.now() + settings.timeoutMs;
  while (Date.now() < deadline) {
    await dependencies.wait(settings.pollIntervalMs, context?.abortSignal);
    const statusResponse = await dependencies.fetch(sessionUrl, {
      headers,
      signal: context?.abortSignal,
    });
    if (!statusResponse.ok) throw await responseError(statusResponse);
    const statusPayload = (await statusResponse.json()) as unknown;
    const status = devinTerminalStatus(statusPayload);
    if (status === "error") throw new Error("Devin session ended without completing");
    if (status !== "complete") continue;
    const messagesResponse = await dependencies.fetch(`${sessionUrl}/messages`, {
      headers,
      signal: context?.abortSignal,
    });
    if (!messagesResponse.ok) throw await responseError(messagesResponse);
    const content = devinMessageContent((await messagesResponse.json()) as unknown);
    if (!content) throw new Error("Devin completed without an assistant response");
    return { content };
  }
  throw new Error(
    `Devin session timed out after ${Math.round(settings.timeoutMs / 1_000)} seconds`
  );
}
