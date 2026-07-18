import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type {
  InitializeParams,
  InitializeResult,
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  TextDocumentPositionParams,
  ReferenceParams,
  PublishDiagnosticsParams,
  DefinitionResult,
  DocumentSymbolResult,
  CompletionResult,
  Location,
  Hover,
} from "./types";
import { LspMessageBuffer } from "./message-buffer";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

export class LSPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private messageBuffer = new LspMessageBuffer();
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private initialized = false;
  private serverCapabilities: InitializeResult["capabilities"] | null = null;

  constructor(
    private command: string,
    private args: string[] = [],
    private rootUri: string
  ) {
    super();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const lowered = this.command.toLowerCase();
        const needsShell =
          process.platform === "win32" && (lowered.endsWith(".cmd") || lowered.endsWith(".bat"));
        const [spawnCommand, spawnArgs] = needsShell
          ? ["cmd.exe", ["/d", "/s", "/c", this.command, ...this.args]]
          : [this.command, this.args];
        this.process = spawn(spawnCommand as string, spawnArgs as string[], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: this.rootUri.replace("file://", ""),
        });

        this.process.stdout?.on("data", (data: Buffer) => {
          this.handleData(data);
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          console.error(`[LSP ${this.command}] stderr:`, data.toString());
        });

        this.process.on("error", (err) => {
          console.error(`[LSP ${this.command}] process error:`, err);
          this.terminate(err);
          reject(err);
        });

        this.process.on("exit", (code, signal) => {
          this.rejectPending(new Error(`LSP process exited: ${this.command}`));
          this.process = null;
          this.initialized = false;
          console.log(`[LSP ${this.command}] exited with code ${code}, signal ${signal}`);
          this.emit("exit", code, signal);
        });

        setTimeout(resolve, 100);
      } catch (err) {
        reject(err);
      }
    });
  }

  async initialize(): Promise<InitializeResult> {
    const params: InitializeParams = {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
        textDocument: {
          synchronization: {
            didSave: true,
          },
          completion: {
            completionItem: {
              snippetSupport: false,
            },
          },
          hover: {},
          definition: {},
          references: {},
          publishDiagnostics: {
            relatedInformation: true,
          },
        },
      },
      workspaceFolders: [
        {
          uri: this.rootUri,
          name: this.rootUri.split("/").pop() || "workspace",
        },
      ],
    };

    const result = await this.request<InitializeResult>("initialize", params);
    this.serverCapabilities = result.capabilities;

    this.notify("initialized", {});
    this.initialized = true;

    console.log(`[LSP ${this.command}] initialized:`, result.serverInfo);
    return result;
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;

    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
    } catch {
      // Ignore errors during shutdown
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
  }

  terminate(reason: Error = new Error(`LSP process terminated: ${this.command}`)): void {
    this.rejectPending(reason);
    this.process?.kill();
    this.process = null;
    this.initialized = false;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
  }

  didOpen(params: DidOpenTextDocumentParams): void {
    this.notify("textDocument/didOpen", params);
  }

  didChange(params: DidChangeTextDocumentParams): void {
    this.notify("textDocument/didChange", params);
  }

  didClose(params: DidCloseTextDocumentParams): void {
    this.notify("textDocument/didClose", params);
  }

  async definition(params: TextDocumentPositionParams): Promise<DefinitionResult> {
    return this.request("textDocument/definition", params);
  }

  async declaration(params: TextDocumentPositionParams): Promise<DefinitionResult> {
    return this.request("textDocument/declaration", params);
  }

  async typeDefinition(params: TextDocumentPositionParams): Promise<DefinitionResult> {
    return this.request("textDocument/typeDefinition", params);
  }

  async implementation(params: TextDocumentPositionParams): Promise<DefinitionResult> {
    return this.request("textDocument/implementation", params);
  }

  async references(params: ReferenceParams): Promise<Location[] | null> {
    return this.request("textDocument/references", params);
  }

  async hover(params: TextDocumentPositionParams): Promise<Hover | null> {
    return this.request("textDocument/hover", params);
  }

  async completion(params: TextDocumentPositionParams): Promise<CompletionResult> {
    return this.request("textDocument/completion", params);
  }

  async documentSymbols(params: { textDocument: { uri: string } }): Promise<DocumentSymbolResult> {
    return this.request("textDocument/documentSymbol", params);
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get capabilities(): InitializeResult["capabilities"] | null {
    return this.serverCapabilities;
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("LSP process not started"));
        return;
      }

      const id = ++this.requestId;
      const message: JsonRpcMessage = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve: resolve as (r: unknown) => void, reject, method });

      const content = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

      this.process.stdin.write(header + content);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.process?.stdin) return;

    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

    this.process.stdin.write(header + content);
  }

  private handleData(data: Buffer): void {
    for (const content of this.messageBuffer.push(data)) {
      try {
        const message = JSON.parse(content) as JsonRpcMessage;
        this.handleMessage(message);
      } catch (err) {
        console.error("[LSP] JSON parse error:", err);
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`LSP error: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    if (message.method) {
      switch (message.method) {
        case "textDocument/publishDiagnostics":
          this.emit("diagnostics", message.params as PublishDiagnosticsParams);
          break;
        case "window/logMessage":
        case "window/showMessage": {
          const msg = message.params as { type: number; message: string };
          console.log(`[LSP ${this.command}]`, msg.message);
          break;
        }
        default:
          // Ignore other notifications
          break;
      }
    }
  }
}
