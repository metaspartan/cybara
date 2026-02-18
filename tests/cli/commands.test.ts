import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let server: ReturnType<typeof Bun.serve>;
let apiBase = "";
const configState: Record<string, unknown> = {
  host: "127.0.0.1",
  port: 4269,
  theme: "indigo",
};

const walletState: {
  exists: boolean;
  unlocked: boolean;
  agentAccessEnabled: boolean;
  unlockExpiresAt?: string;
  primaryAddresses?: Record<string, string>;
} = {
  exists: true,
  unlocked: true,
  agentAccessEnabled: false,
  unlockExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  primaryAddresses: {
    eth: "0x1111111111111111111111111111111111111111",
    btc: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
    sol: "3fM5V9iUGn2YvBG3VDBgaR7jWT8QdbdbfF7wq9fN4sJ5",
  },
};

const walletRpcState = {
  ethRpc: "https://ethereum-rpc.publicnode.com",
  solRpc: "https://api.mainnet-beta.solana.com",
  btcApi: "https://mempool.space/api",
};

const walletAgentPolicyState = {
  allowNativeSend: false,
  allowTokenSend: false,
  allowEthContractWrite: false,
  allowSolProgramInstruction: false,
  allowEthSwaps: false,
  allowedEthContracts: [] as string[],
  allowedSolPrograms: [] as string[],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function route(method: string, url: URL, body: string): Response {
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    return json({
      status: "healthy",
      uptime: 321,
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: "healthy", total: 1 },
        providers: { status: "healthy", total: 1 },
      },
    });
  }

  if (method === "GET" && pathname === "/api/metrics/overview") {
    return json({
      tokenUsage: { total: 42, input: 20, output: 22, cache: 0 },
      fileOperations: { filesRead: 3, filesWritten: 1, filesEdited: 1 },
      toolCalls: { totalCalls: 4 },
      apiCalls: { totalCalls: 8, successfulCalls: 8, failedCalls: 0 },
      agentExecutions: { totalExecutions: 2, totalMessages: 5 },
    });
  }

  if (method === "GET" && pathname === "/api/agents") {
    return json([
      {
        id: "agent-1",
        name: "Primary Agent",
        type: "assistant",
        status: "running",
        model: "claude-sonnet",
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/providers") {
    return json([
      {
        id: "prov-1",
        provider: "anthropic",
        name: "Anthropic Main",
        is_default: true,
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/providers/available") {
    return json([
      {
        id: "anthropic",
        name: "Anthropic",
        description: "Claude models",
        baseUrl: "https://api.anthropic.com",
        authType: "apiKey",
        models: [{ id: "claude-sonnet", name: "Claude Sonnet", context: 200000 }],
      },
    ]);
  }

  if (method === "POST" && pathname === "/api/providers") {
    const parsed = body
      ? (JSON.parse(body) as { provider?: string; name?: string; api_key?: string })
      : {};
    if (!parsed.provider) {
      return json({ error: "missing provider" }, 400);
    }
    return json({ id: "prov-created", name: parsed.name || parsed.provider });
  }

  if (method === "PUT" && pathname === "/api/providers/prov-1") {
    return json({ success: true });
  }

  if (method === "DELETE" && pathname === "/api/providers/prov-1") {
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/providers/prov-1/models") {
    return json([
      { id: "claude-sonnet", name: "Claude Sonnet", context: 200000 },
      { id: "claude-haiku", name: "Claude Haiku", context: 200000 },
    ]);
  }

  if (method === "POST" && pathname === "/api/providers/discover/ollama") {
    return json({
      models: [{ id: "llama3.1:8b" }, { id: "qwen2.5:14b" }],
    });
  }

  if (method === "GET" && pathname === "/api/channels") {
    return json([
      { id: "chan-1", name: "Discord Ops", type: "discord", enabled: true, dmPolicy: "pairing" },
      {
        id: "chan-2",
        name: "Telegram Support",
        type: "telegram",
        enabled: false,
        dmPolicy: "allowlist",
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/channels/chan-1/pairings") {
    return json({
      pairings: [
        {
          id: "pair-1",
          senderId: "user-777",
          code: "PAIR42",
          platform: "discord",
          displayName: "Alice",
          status: "pending",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        },
      ],
      pendingCount: 1,
    });
  }

  if (method === "GET" && pathname === "/api/channels/chan-2/pairings") {
    return json({ pairings: [], pendingCount: 0 });
  }

  if (method === "POST" && pathname === "/api/channels/chan-1/pairings/verify") {
    const parsed = body ? (JSON.parse(body) as { code?: string }) : {};
    if (parsed.code === "PAIR42") {
      return json({ success: true, senderId: "user-777" });
    }
    return json({ success: false, error: "invalid code" });
  }

  if (method === "POST" && pathname === "/api/channels/chan-2/pairings/verify") {
    return json({ success: false, error: "not found" });
  }

  if (method === "POST" && pathname === "/api/channels/chan-1/pairings/pair-1/reject") {
    return json({ success: true });
  }

  if (method === "PUT" && pathname === "/api/channels/chan-1/security") {
    const parsed = body ? (JSON.parse(body) as { dm_policy?: string }) : {};
    return json({ success: true, config: { dm_policy: parsed.dm_policy || "pairing" } });
  }

  if (method === "GET" && pathname === "/api/tasks") {
    return json([
      { id: "task-1", name: "Nightly Check", status: "pending", schedule: "0 2 * * *" },
    ]);
  }

  if (method === "GET" && pathname === "/api/skills/status") {
    return json({
      skills: [
        { name: "checks", description: "Checks", eligible: true, source: "system" },
        { name: "ops", description: "Ops", eligible: false, source: "workspace" },
      ],
    });
  }

  if (method === "GET" && pathname === "/api/chat/sessions") {
    return json([
      {
        id: "session-1",
        agent_id: "agent-1",
        message_count: 4,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/memory") {
    return json([{ id: "m-1", content: "remember this", createdAt: new Date().toISOString() }]);
  }

  if (method === "GET" && pathname === "/api/memory/search") {
    const query = url.searchParams.get("query") || "";
    return json({
      results: [
        {
          file: "2026-01-01.md",
          entry: {
            timestamp: "12:00:00",
            date: "2026-01-01",
            type: "note",
            tags: ["manual"],
            content: `result for ${query}`,
            index: 0,
          },
        },
      ],
    });
  }

  if (method === "GET" && pathname === "/api/logs/system") {
    return json([
      { timestamp: new Date().toISOString(), level: "info", module: "api", message: "ok" },
    ]);
  }

  if (method === "GET" && pathname === "/api/config") {
    return json(configState);
  }

  if (method === "PUT" && pathname === "/api/config") {
    const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    Object.assign(configState, parsed);
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/subagents") {
    return json([
      {
        id: "sub-1",
        task: "Analyze logs",
        label: "Analyze logs for errors",
        status: "running",
        createdAt: new Date().toISOString(),
      },
      {
        id: "sub-2",
        task: "Write summary",
        label: "Write release summary",
        status: "completed",
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  if (method === "POST" && pathname === "/api/subagents/spawn") {
    const parsed = body ? (JSON.parse(body) as { task?: string }) : {};
    if (!parsed.task) return json({ error: "missing task" }, 400);
    return json({ id: "sub-2" });
  }

  if (method === "POST" && pathname === "/api/subagents/sub-2/kill") {
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/mcp") {
    return json([
      {
        id: "mcp-1",
        name: "Filesystem MCP",
        command: "npx @modelcontextprotocol/server-filesystem",
        status: "running",
        toolCount: 12,
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/mcp/registry/popular") {
    return json([
      {
        id: "filesystem",
        name: "Filesystem",
        description: "Read and write files",
        registry: "modelcontextprotocol",
        package: "@modelcontextprotocol/server-filesystem",
        command: "npx",
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/mcp/registry/search") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    return json([
      {
        id: q || "filesystem",
        name: q ? `Result for ${q}` : "Filesystem",
        description: "Registry search result",
        registry: "modelcontextprotocol",
        package: "@modelcontextprotocol/server-git",
        command: "npx",
      },
    ]);
  }

  if (method === "POST" && pathname === "/api/mcp/registry/install") {
    const parsed = body ? (JSON.parse(body) as { package?: string }) : {};
    if (!parsed.package) return json({ success: false, error: "missing package" }, 400);
    return json({ success: true, id: "mcp-installed-1" });
  }

  if (method === "GET" && pathname === "/api/lsp/install-status") {
    return json({
      status: [
        {
          language: "typescript",
          displayName: "TypeScript",
          description: "Bundled TS/JS server",
          type: "bundled",
          installed: true,
          available: true,
          path: null,
        },
        {
          language: "python",
          displayName: "Python",
          description: "Pyright",
          type: "binary",
          installed: false,
          available: true,
          path: "/usr/local/bin/pyright-langserver",
          requiresRuntime: "node",
        },
      ],
    });
  }

  if (method === "POST" && pathname === "/api/lsp/install") {
    const parsed = body ? (JSON.parse(body) as { language?: string }) : {};
    if (!parsed.language) return json({ success: false, error: "language required" }, 400);
    return json({ success: true, path: `/mock/lsp/${parsed.language}` });
  }

  if (method === "POST" && pathname === "/api/lsp/uninstall") {
    const parsed = body ? (JSON.parse(body) as { language?: string }) : {};
    if (!parsed.language) return json({ success: false, error: "language required" }, 400);
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/browser/status") {
    return json({
      running: true,
      profile: "default",
      currentUrl: "https://example.com",
    });
  }

  if (method === "GET" && pathname === "/api/browser/tabs") {
    return json({
      tabs: [
        { id: "tab-1", url: "https://example.com", title: "Example Domain" },
        { id: "tab-2", url: "https://docs.cybara.dev", title: "Cybara Docs" },
      ],
    });
  }

  if (method === "GET" && pathname === "/api/wallet/status") {
    return json({
      exists: walletState.exists,
      unlocked: walletState.unlocked,
      address: walletState.primaryAddresses?.eth,
      unlockExpiresAt: walletState.unlockExpiresAt,
      agentAccessEnabled: walletState.agentAccessEnabled,
      chains: ["eth", "btc", "sol"],
      primaryAddresses: walletState.primaryAddresses,
    });
  }

  if (method === "GET" && pathname === "/api/wallet/rpc") {
    return json(walletRpcState);
  }

  if (method === "GET" && pathname === "/api/wallet/rpc/status") {
    return json({
      checkedAt: new Date().toISOString(),
      services: [
        {
          chain: "eth",
          endpoint: walletRpcState.ethRpc,
          healthy: true,
          latencyMs: 21,
          latestHeight: "22000000",
        },
        {
          chain: "sol",
          endpoint: walletRpcState.solRpc,
          healthy: true,
          latencyMs: 44,
          latestHeight: "320000000",
        },
        {
          chain: "btc",
          endpoint: walletRpcState.btcApi,
          healthy: true,
          latencyMs: 18,
          latestHeight: "885000",
        },
      ],
    });
  }

  if (method === "GET" && pathname === "/api/wallet/agent-policy") {
    return json(walletAgentPolicyState);
  }

  if (method === "PUT" && pathname === "/api/wallet/rpc") {
    const parsed = body
      ? (JSON.parse(body) as { ethRpc?: string; solRpc?: string; btcApi?: string })
      : {};
    if (parsed.ethRpc) walletRpcState.ethRpc = parsed.ethRpc;
    if (parsed.solRpc) walletRpcState.solRpc = parsed.solRpc;
    if (parsed.btcApi) walletRpcState.btcApi = parsed.btcApi;
    return json({ success: true, config: walletRpcState });
  }

  if (method === "PUT" && pathname === "/api/wallet/agent-policy") {
    const parsed = body ? (JSON.parse(body) as Partial<typeof walletAgentPolicyState>) : {};
    if (typeof parsed.allowNativeSend === "boolean")
      walletAgentPolicyState.allowNativeSend = parsed.allowNativeSend;
    if (typeof parsed.allowTokenSend === "boolean")
      walletAgentPolicyState.allowTokenSend = parsed.allowTokenSend;
    if (typeof parsed.allowEthContractWrite === "boolean")
      walletAgentPolicyState.allowEthContractWrite = parsed.allowEthContractWrite;
    if (typeof parsed.allowSolProgramInstruction === "boolean")
      walletAgentPolicyState.allowSolProgramInstruction = parsed.allowSolProgramInstruction;
    if (typeof parsed.allowEthSwaps === "boolean")
      walletAgentPolicyState.allowEthSwaps = parsed.allowEthSwaps;
    if (Array.isArray(parsed.allowedEthContracts))
      walletAgentPolicyState.allowedEthContracts = parsed.allowedEthContracts.filter(
        (value): value is string => typeof value === "string"
      );
    if (Array.isArray(parsed.allowedSolPrograms))
      walletAgentPolicyState.allowedSolPrograms = parsed.allowedSolPrograms.filter(
        (value): value is string => typeof value === "string"
      );
    return json({ success: true, policy: walletAgentPolicyState });
  }

  if (method === "POST" && pathname === "/api/wallet/create") {
    const parsed = body ? (JSON.parse(body) as { password?: string }) : {};
    if (!parsed.password) return json({ error: "password required" }, 400);
    walletState.exists = true;
    walletState.unlocked = true;
    walletState.unlockExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return json({
      success: true,
      mnemonic:
        "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega",
      address: walletState.primaryAddresses?.eth,
      primaryAddresses: walletState.primaryAddresses,
    });
  }

  if (method === "POST" && pathname === "/api/wallet/import") {
    const parsed = body ? (JSON.parse(body) as { password?: string; mnemonic?: string }) : {};
    if (!parsed.password || !parsed.mnemonic)
      return json({ error: "password and mnemonic required" }, 400);
    walletState.exists = true;
    walletState.unlocked = true;
    walletState.unlockExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return json({
      success: true,
      mnemonic: parsed.mnemonic,
      address: walletState.primaryAddresses?.eth,
      primaryAddresses: walletState.primaryAddresses,
    });
  }

  if (method === "POST" && pathname === "/api/wallet/unlock") {
    const parsed = body ? (JSON.parse(body) as { password?: string }) : {};
    if (!parsed.password) return json({ error: "password required" }, 400);
    walletState.unlocked = true;
    walletState.unlockExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return json({
      success: true,
      address: walletState.primaryAddresses?.eth,
      unlockExpiresAt: walletState.unlockExpiresAt,
      primaryAddresses: walletState.primaryAddresses,
    });
  }

  if (method === "POST" && pathname === "/api/wallet/lock") {
    walletState.unlocked = false;
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/wallet/accounts") {
    const count = Number(url.searchParams.get("count") || "1");
    const startIndex = Number(url.searchParams.get("startIndex") || "0");
    const chains = (url.searchParams.get("chains") || "eth,btc,sol").split(",");
    const accounts = chains.flatMap((chain) =>
      Array.from({ length: Math.max(1, count) }).map((_, offset) => ({
        chain,
        index: startIndex + offset,
        path: `m/mock/${chain}/${startIndex + offset}`,
        address: `${chain}-address-${startIndex + offset}`,
      }))
    );
    return json(accounts);
  }

  if (method === "GET" && pathname === "/api/wallet/receive") {
    const chain = url.searchParams.get("chain") || "eth";
    const index = Number(url.searchParams.get("index") || "0");
    return json({
      chain,
      index,
      path: `m/mock/${chain}/${index}`,
      address: `${chain}-address-${index}`,
    });
  }

  if (method === "GET" && pathname === "/api/wallet/balances") {
    const count = Number(url.searchParams.get("count") || "1");
    const startIndex = Number(url.searchParams.get("startIndex") || "0");
    const chains = (url.searchParams.get("chains") || "eth,btc,sol").split(",");
    const symbolByChain: Record<string, string> = { eth: "ETH", btc: "BTC", sol: "SOL" };
    const balances = chains.flatMap((chain) =>
      Array.from({ length: Math.max(1, count) }).map((_, offset) => ({
        chain,
        index: startIndex + offset,
        path: `m/mock/${chain}/${startIndex + offset}`,
        address: `${chain}-address-${startIndex + offset}`,
        symbol: symbolByChain[chain] || chain.toUpperCase(),
        amount: chain === "eth" ? "0.5" : chain === "btc" ? "0.01" : "2.3",
      }))
    );
    return json(balances);
  }

  if (method === "GET" && pathname === "/api/wallet/tokens") {
    const chain = (url.searchParams.get("chain") || "eth") as "eth" | "sol";
    const index = Number(url.searchParams.get("index") || "0");
    return json([
      {
        chain,
        index,
        address: `${chain}-address-${index}`,
        tokenAddress:
          chain === "eth"
            ? "0xToken000000000000000000000000000000000001"
            : "So11111111111111111111111111111111111111112",
        symbol: chain === "eth" ? "USDC" : "SPL",
        amount: "4.2",
        decimals: chain === "eth" ? 6 : 9,
        raw: chain === "eth" ? "4200000" : "4200000000",
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/wallet/transactions") {
    const chain = url.searchParams.get("chain") || "eth";
    return json([
      {
        txid: `${chain}-tx-1`,
        status: "confirmed",
        amount: "0.1",
        fee: "0.001",
        from: `${chain}-from`,
        to: `${chain}-to`,
        timestamp: new Date().toISOString(),
        explorerUrl: `https://explorer.example/${chain}/tx/${chain}-tx-1`,
      },
    ]);
  }

  if (method === "GET" && pathname === "/api/wallet/token-transactions") {
    const chain = (url.searchParams.get("chain") || "eth") as "eth" | "sol";
    const index = Number(url.searchParams.get("index") || "0");
    return json([
      {
        chain,
        index,
        address: `${chain}-address-${index}`,
        tokenAddress:
          chain === "eth"
            ? "0xToken000000000000000000000000000000000001"
            : "So11111111111111111111111111111111111111112",
        symbol: chain === "eth" ? "USDC" : "SPL",
        decimals: chain === "eth" ? 6 : 9,
        txid: `${chain}-token-tx-1`,
        status: "confirmed",
        direction: "in",
        amount: "1.25",
        raw: chain === "eth" ? "1250000" : "1250000000",
        explorerUrl: `https://explorer.example/${chain}/tx/${chain}-token-tx-1`,
      },
    ]);
  }

  if (method === "POST" && pathname === "/api/wallet/send") {
    const parsed = body
      ? (JSON.parse(body) as { chain?: string; to?: string; amount?: string })
      : {};
    if (!parsed.chain || !parsed.to || !parsed.amount)
      return json({ error: "invalid payload" }, 400);
    return json({
      chain: parsed.chain,
      txid: `${parsed.chain}-tx-sent-1`,
      explorerUrl: `https://explorer.example/${parsed.chain}/tx/${parsed.chain}-tx-sent-1`,
    });
  }

  if (method === "POST" && pathname === "/api/wallet/send-token") {
    const parsed = body
      ? (JSON.parse(body) as {
          chain?: "eth" | "sol";
          tokenAddress?: string;
          to?: string;
          amount?: string;
        })
      : {};
    if (!parsed.chain || !parsed.tokenAddress || !parsed.to || !parsed.amount) {
      return json({ error: "invalid payload" }, 400);
    }
    return json({
      chain: parsed.chain,
      tokenAddress: parsed.tokenAddress,
      txid: `${parsed.chain}-token-tx-sent-1`,
      explorerUrl: `https://explorer.example/${parsed.chain}/tx/${parsed.chain}-token-tx-sent-1`,
    });
  }

  if (method === "POST" && pathname === "/api/wallet/eth-contract") {
    const parsed = body
      ? (JSON.parse(body) as {
          contractAddress?: string;
          abi?: string;
          method?: string;
          methodSignature?: string;
          gasLimit?: string;
          nonce?: number;
          readOnly?: boolean;
        })
      : {};
    if (!parsed.contractAddress || !parsed.method || (!parsed.abi && !parsed.methodSignature)) {
      return json({ error: "invalid payload" }, 400);
    }
    return json({
      chain: "eth",
      readOnly: parsed.readOnly === true,
      contractAddress: parsed.contractAddress,
      method: parsed.method,
      methodSignature: parsed.methodSignature,
      nonce: parsed.nonce,
      gasLimit: parsed.gasLimit,
      result: "mock-result",
    });
  }

  if (method === "POST" && pathname === "/api/wallet/sol-instruction") {
    const parsed = body
      ? (JSON.parse(body) as {
          programId?: string;
          keys?: unknown[];
          accounts?: unknown[];
        })
      : {};
    if (!parsed.programId || (!Array.isArray(parsed.keys) && !Array.isArray(parsed.accounts))) {
      return json({ error: "invalid payload" }, 400);
    }
    return json({
      chain: "sol",
      txid: "sol-inst-tx-1",
      explorerUrl: "https://explorer.example/sol/tx/sol-inst-tx-1",
    });
  }

  if (method === "POST" && pathname === "/api/wallet/swap-eth-uniswap") {
    const parsed = body
      ? (JSON.parse(body) as {
          tokenOut?: string;
          percent?: number;
          amountEth?: string;
          dryRun?: boolean;
        })
      : {};
    if (!parsed.tokenOut || (!parsed.percent && !parsed.amountEth)) {
      return json({ error: "invalid payload" }, 400);
    }
    return json({
      chain: "eth",
      dex: "uniswap_v2",
      from: walletState.primaryAddresses?.eth,
      toTokenAddress: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
      toTokenSymbol: parsed.tokenOut,
      amountInEth: parsed.amountEth || "0.5",
      amountInWei: "500000000000000000",
      quotedAmountOut: "100",
      quotedAmountOutRaw: "100000000000000000000",
      minAmountOut: "99",
      minAmountOutRaw: "99000000000000000000",
      slippageBps: 100,
      recipient: walletState.primaryAddresses?.eth,
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      dryRun: parsed.dryRun === true,
      txid: parsed.dryRun ? undefined : "swap-tx-1",
      explorerUrl: parsed.dryRun ? undefined : "https://etherscan.io/tx/swap-tx-1",
    });
  }

  if (method === "POST" && pathname === "/api/wallet/price") {
    const parsed = body
      ? (JSON.parse(body) as { source?: string; symbol?: string; pair?: string; mint?: string })
      : {};
    if (!parsed.symbol && !parsed.pair && !parsed.mint) {
      return json({ error: "invalid payload" }, 400);
    }
    return json({
      source: parsed.source || "auto",
      base: parsed.symbol || "BTC",
      quote: "USD",
      price: "123.45",
      feedId: "0xfeed",
    });
  }

  if (method === "POST" && pathname === "/api/wallet/swap") {
    const parsed = body
      ? (JSON.parse(body) as {
          venue?: "uniswap_v2" | "uniswap_v3" | "jupiter";
          tokenOut?: string;
          inputMint?: string;
          outputMint?: string;
          amountEth?: string;
          amount?: string;
          dryRun?: boolean;
        })
      : {};

    if (
      !parsed.venue ||
      (parsed.venue !== "jupiter" && !parsed.tokenOut) ||
      (parsed.venue === "jupiter" && (!parsed.inputMint || !parsed.outputMint))
    ) {
      return json({ error: "invalid payload" }, 400);
    }

    return json({
      venue: parsed.venue,
      chain: parsed.venue === "jupiter" ? "sol" : "eth",
      from:
        parsed.venue === "jupiter"
          ? walletState.primaryAddresses?.sol
          : walletState.primaryAddresses?.eth,
      inputToken:
        parsed.venue === "jupiter"
          ? parsed.inputMint
          : "ETH",
      outputToken:
        parsed.venue === "jupiter"
          ? parsed.outputMint
          : parsed.tokenOut,
      amountIn:
        parsed.venue === "jupiter"
          ? parsed.amount || "1"
          : parsed.amountEth || "0.5",
      amountInRaw: "1000000000",
      quotedAmountOut: "100",
      quotedAmountOutRaw: "100000000",
      minAmountOut: "99",
      minAmountOutRaw: "99000000",
      slippageBps: 100,
      dryRun: parsed.dryRun === true,
      route: parsed.venue === "jupiter" ? "Jupiter Router" : "uniswap",
      txid: parsed.dryRun ? undefined : "dynamic-swap-tx-1",
      explorerUrl: parsed.dryRun
        ? undefined
        : parsed.venue === "jupiter"
          ? "https://solscan.io/tx/dynamic-swap-tx-1"
          : "https://etherscan.io/tx/dynamic-swap-tx-1",
    });
  }

  if (method === "POST" && pathname === "/api/wallet/sign") {
    return json({ address: walletState.primaryAddresses?.eth, signature: "0xsignature" });
  }

  if (method === "PUT" && pathname === "/api/wallet/agent-access") {
    const parsed = body ? (JSON.parse(body) as { enabled?: boolean }) : {};
    walletState.agentAccessEnabled = parsed.enabled === true;
    return json({ success: true, enabled: walletState.agentAccessEnabled });
  }

  return json({ error: `Unhandled route: ${method} ${pathname}` }, 404);
}

async function runCli(
  args: string[],
  envOverride?: Record<string, string>
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli.tsx", ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CYBARA_API: apiBase,
      ...envOverride,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
}

describe("CLI Commands", () => {
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        let body = "";
        if (req.method !== "GET" && req.method !== "HEAD") {
          try {
            body = await req.text();
          } catch {
            body = "";
          }
        }
        return route(req.method, url, body);
      },
    });
    apiBase = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("--version prints CLI version", async () => {
    const { exitCode, stdout } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cybara v");
  });

  test("help prints command summary", async () => {
    const { exitCode, stdout } = await runCli(["help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA CLI");
    expect(stdout).toContain("provider");
    expect(stdout).toContain("channels");
  });

  test("status command renders health summary", async () => {
    const { exitCode, stdout } = await runCli(["status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA STATUS");
    expect(stdout).toContain("status: healthy");
    expect(stdout).toContain("HEALTH CHECKS");
  });

  test("metrics command renders usage summary", async () => {
    const { exitCode, stdout } = await runCli(["metrics"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA METRICS");
    expect(stdout).toContain("TOKEN USAGE");
    expect(stdout).toContain("total: 42");
  });

  test("provider list/available commands are wired", async () => {
    const list = await runCli(["provider"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("CYBARA PROVIDERS");
    expect(list.stdout).toContain("Anthropic Main");

    const available = await runCli(["provider", "available"]);
    expect(available.exitCode).toBe(0);
    expect(available.stdout).toContain("AVAILABLE PROVIDER TYPES");
    expect(available.stdout).toContain("anthropic");
  });

  test("channels command renders list and pair policy updates config", async () => {
    const channels = await runCli(["channels"]);
    expect(channels.exitCode).toBe(0);
    expect(channels.stdout).toContain("CYBARA CHANNELS");
    expect(channels.stdout).toContain("Discord Ops");

    const policy = await runCli(["pair", "policy", "Discord Ops", "allowlist"]);
    expect(policy.exitCode).toBe(0);
    expect(policy.stdout).toContain("DM policy updated");
    expect(policy.stdout).toContain("allowlist");
  });

  test("tasks/skills/sessions/logs/memory commands are wired", async () => {
    const tasks = await runCli(["tasks"]);
    expect(tasks.exitCode).toBe(0);
    expect(tasks.stdout).toContain("CYBARA TASKS");

    const skills = await runCli(["skills"]);
    expect(skills.exitCode).toBe(0);
    expect(skills.stdout).toContain("CYBARA SKILLS");

    const sessions = await runCli(["sessions"]);
    expect(sessions.exitCode).toBe(0);
    expect(sessions.stdout).toContain("CYBARA SESSIONS");

    const memory = await runCli(["memory"]);
    expect(memory.exitCode).toBe(0);
    expect(memory.stdout).toContain("CYBARA MEMORY");

    const logs = await runCli(["logs", "1"]);
    expect(logs.exitCode).toBe(0);
    expect(logs.stdout).toContain("CYBARA LOGS");
  });

  test("config commands list/get/set are wired", async () => {
    const list = await runCli(["config"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("CYBARA CONFIG");
    expect(list.stdout).toContain('host = "127.0.0.1"');

    const getHost = await runCli(["config", "get", "host"]);
    expect(getHost.exitCode).toBe(0);
    expect(getHost.stdout).toContain('host = "127.0.0.1"');

    const setTheme = await runCli(["config", "set", "theme", "teal"]);
    expect(setTheme.exitCode).toBe(0);
    expect(setTheme.stdout).toContain("Set theme = teal");

    const getTheme = await runCli(["config", "get", "theme"]);
    expect(getTheme.exitCode).toBe(0);
    expect(getTheme.stdout).toContain('theme = "teal"');
  });

  test("browser commands are wired", async () => {
    const status = await runCli(["browser"]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("CYBARA BROWSER");
    expect(status.stdout).toContain("status: running");
    expect(status.stdout).toContain("url: https://example.com");

    const tabs = await runCli(["browser", "tabs"]);
    expect(tabs.exitCode).toBe(0);
    expect(tabs.stdout).toContain("BROWSER TABS");
    expect(tabs.stdout).toContain("Example Domain");
    expect(tabs.stdout).toContain("Cybara Docs");
  });

  test("wallet command group is wired", async () => {
    const status = await runCli(["wallet", "status"]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("CYBARA WALLET");
    expect(status.stdout).toContain("RPC ENDPOINTS");

    const accounts = await runCli([
      "wallet",
      "accounts",
      "--chains",
      "eth,btc",
      "--count",
      "2",
      "--start",
      "1",
    ]);
    expect(accounts.exitCode).toBe(0);
    expect(accounts.stdout).toContain("WALLET ACCOUNTS");
    expect(accounts.stdout).toContain("ETH index 1");

    const balances = await runCli([
      "wallet",
      "balances",
      "--chains",
      "sol",
      "--count",
      "1",
      "--start",
      "0",
    ]);
    expect(balances.exitCode).toBe(0);
    expect(balances.stdout).toContain("WALLET BALANCES");
    expect(balances.stdout).toContain("SOL index 0");

    const tokens = await runCli(["wallet", "tokens", "eth", "--index", "1", "--include-zero"]);
    expect(tokens.exitCode).toBe(0);
    expect(tokens.stdout).toContain("WALLET TOKENS (ETH)");
    expect(tokens.stdout).toContain("USDC");

    const tokenTx = await runCli(["wallet", "token-tx", "sol", "--index", "1", "--limit", "5"]);
    expect(tokenTx.exitCode).toBe(0);
    expect(tokenTx.stdout).toContain("WALLET TOKEN TRANSACTIONS (SOL)");
    expect(tokenTx.stdout).toContain("sol-token-tx-1");

    const receive = await runCli(["wallet", "receive", "btc", "--index", "3"]);
    expect(receive.exitCode).toBe(0);
    expect(receive.stdout).toContain("WALLET RECEIVE ADDRESS");
    expect(receive.stdout).toContain("BTC");

    const tx = await runCli(["wallet", "tx", "eth", "--index", "0", "--limit", "5"]);
    expect(tx.exitCode).toBe(0);
    expect(tx.stdout).toContain("WALLET TRANSACTIONS (ETH)");
    expect(tx.stdout).toContain("eth-tx-1");

    const send = await runCli([
      "wallet",
      "send",
      "sol",
      "--to",
      "sol-address-4",
      "--amount",
      "0.3",
    ]);
    expect(send.exitCode).toBe(0);
    expect(send.stdout).toContain("Transaction submitted");
    expect(send.stdout).toContain("SOL");

    const sendToken = await runCli([
      "wallet",
      "send-token",
      "eth",
      "--token",
      "0xToken000000000000000000000000000000000001",
      "--to",
      "0xReceiver0000000000000000000000000000000001",
      "--amount",
      "1.2",
    ]);
    expect(sendToken.exitCode).toBe(0);
    expect(sendToken.stdout).toContain("Token transaction submitted");
    expect(sendToken.stdout).toContain("ETH");

    const swapQuote = await runCli([
      "wallet",
      "swap-eth-uniswap",
      "--token",
      "LINK",
      "--percent",
      "50",
    ]);
    expect(swapQuote.exitCode).toBe(0);
    expect(swapQuote.stdout).toContain("UNISWAP ETH SWAP");
    expect(swapQuote.stdout).toContain("quote-only");
    expect(swapQuote.stdout).not.toContain("txid:");

    const swapExecute = await runCli([
      "wallet",
      "swap-eth-uniswap",
      "--token",
      "LINK",
      "--amount-eth",
      "0.25",
      "--execute",
    ]);
    expect(swapExecute.exitCode).toBe(0);
    expect(swapExecute.stdout).toContain("UNISWAP ETH SWAP");
    expect(swapExecute.stdout).toContain("mode: execute");
    expect(swapExecute.stdout).toContain("txid: swap-tx-1");
    expect(swapExecute.stdout).toContain("explorer: https://etherscan.io/tx/swap-tx-1");

    const priceQuote = await runCli(["wallet", "price", "--source", "chainlink", "--symbol", "BTC"]);
    expect(priceQuote.exitCode).toBe(0);
    expect(priceQuote.stdout).toContain("PRICE QUOTE");
    expect(priceQuote.stdout).toContain("pair: BTC/USD");
    expect(priceQuote.stdout).toContain("price: 123.45");

    const dynamicSwapQuote = await runCli([
      "wallet",
      "swap-quote",
      "--venue",
      "uniswap_v3",
      "--token",
      "LINK",
      "--amount-eth",
      "0.2",
      "--fee-tier",
      "3000",
    ]);
    expect(dynamicSwapQuote.exitCode).toBe(0);
    expect(dynamicSwapQuote.stdout).toContain("SWAP RESULT");
    expect(dynamicSwapQuote.stdout).toContain("mode: quote-only");
    expect(dynamicSwapQuote.stdout).toContain("venue: uniswap_v3");

    const dynamicSwapExecute = await runCli([
      "wallet",
      "swap-execute",
      "--venue",
      "jupiter",
      "--input-mint",
      "So11111111111111111111111111111111111111112",
      "--output-mint",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "--amount",
      "1.2",
    ]);
    expect(dynamicSwapExecute.exitCode).toBe(0);
    expect(dynamicSwapExecute.stdout).toContain("SWAP RESULT");
    expect(dynamicSwapExecute.stdout).toContain("mode: execute");
    expect(dynamicSwapExecute.stdout).toContain("venue: jupiter");
    expect(dynamicSwapExecute.stdout).toContain("txid: dynamic-swap-tx-1");

    const contractCall = await runCli([
      "wallet",
      "contract-call",
      "--contract",
      "0x0000000000000000000000000000000000000001",
      "--signature",
      "totalSupply()",
      "--gas-limit",
      "210000",
      "--nonce",
      "3",
      "--read",
    ]);
    expect(contractCall.exitCode).toBe(0);
    expect(contractCall.stdout).toContain("ETH contract call result");
    expect(contractCall.stdout).toContain("mock-result");
    expect(contractCall.stdout).toContain("totalSupply()");

    const solInstruction = await runCli([
      "wallet",
      "sol-instruction",
      "--program",
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      "--accounts",
      '[{"pubkey":"11111111111111111111111111111111","isSigner":false,"isWritable":false}]',
      "--data-hex",
      "0x0102",
      "--compute-units",
      "180000",
      "--compute-price-microlamports",
      "2000",
    ]);
    expect(solInstruction.exitCode).toBe(0);
    expect(solInstruction.stdout).toContain("Solana instruction submitted");
    expect(solInstruction.stdout).toContain("sol-inst-tx-1");

    const rpcStatus = await runCli(["wallet", "rpc", "status"]);
    expect(rpcStatus.exitCode).toBe(0);
    expect(rpcStatus.stdout).toContain("WALLET RPC STATUS");
    expect(rpcStatus.stdout).toContain("ETH healthy");

    const rpcSet = await runCli([
      "wallet",
      "rpc",
      "set",
      "--eth",
      "https://eth.example",
      "--sol",
      "https://sol.example",
      "--btc",
      "https://btc.example",
    ]);
    expect(rpcSet.exitCode).toBe(0);
    expect(rpcSet.stdout).toContain("Wallet RPC settings updated");

    const policyShow = await runCli(["wallet", "agent-policy"]);
    expect(policyShow.exitCode).toBe(0);
    expect(policyShow.stdout).toContain("WALLET AGENT POLICY");
    expect(policyShow.stdout).toContain("allow_eth_swaps");

    const policySet = await runCli([
      "wallet",
      "agent-policy",
      "set",
      "--json",
      '{"allowNativeSend":true,"allowTokenSend":true,"allowEthSwaps":true}',
    ]);
    expect(policySet.exitCode).toBe(0);
    expect(policySet.stdout).toContain("Wallet agent policy updated");

    const agentAccess = await runCli(["wallet", "agent-access", "on"]);
    expect(agentAccess.exitCode).toBe(0);
    expect(agentAccess.stdout).toContain("Agent wallet access enabled");

    const lock = await runCli(["wallet", "lock"]);
    expect(lock.exitCode).toBe(0);
    expect(lock.stdout).toContain("Wallet locked");

    const unlock = await runCli(["wallet", "unlock", "--password", "supersecret123"]);
    expect(unlock.exitCode).toBe(0);
    expect(unlock.stdout).toContain("Wallet unlocked");
  });

  test("memory search query path is wired", async () => {
    const search = await runCli(["memory", "integration"]);
    expect(search.exitCode).toBe(0);
    expect(search.stdout).toContain('query: "integration"');
    expect(search.stdout).toContain("results: 1");
  });

  test("pairing commands list, approve, and reject are wired", async () => {
    const list = await runCli(["pair", "list"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("PENDING PAIRINGS");
    expect(list.stdout).toContain("PAIR42");

    const approve = await runCli(["pair", "pair42"]);
    expect(approve.exitCode).toBe(0);
    expect(approve.stdout).toContain("Pairing approved");
    expect(approve.stdout).toContain("sender: user-777");

    const reject = await runCli(["pair", "reject", "PAIR42"]);
    expect(reject.exitCode).toBe(0);
    expect(reject.stdout).toContain("Pairing rejected");
    expect(reject.stdout).toContain("sender: user-777");
  });

  test("provider write/model/discover commands are wired", async () => {
    const add = await runCli([
      "provider",
      "add",
      "anthropic",
      "--name",
      "Anthropic CI",
      "--key",
      "test-key",
      "--default",
    ]);
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("Added provider: Anthropic CI");

    const update = await runCli(["provider", "update", "prov-1", "--name", "Anthropic Updated"]);
    expect(update.exitCode).toBe(0);
    expect(update.stdout).toContain("Updated provider: prov-1");

    const models = await runCli(["provider", "models", "prov-1"]);
    expect(models.exitCode).toBe(0);
    expect(models.stdout).toContain("MODELS FOR PROVIDER prov-1");
    expect(models.stdout).toContain("claude-sonnet");

    const discover = await runCli(["provider", "discover"]);
    expect(discover.exitCode).toBe(0);
    expect(discover.stdout).toContain("Discovered 2 Ollama models");

    const del = await runCli(["provider", "delete", "prov-1"]);
    expect(del.exitCode).toBe(0);
    expect(del.stdout).toContain("Deleted provider: prov-1");
  });

  test("subagent and mcp command groups are wired", async () => {
    const subagents = await runCli(["subagent"]);
    expect(subagents.exitCode).toBe(0);
    expect(subagents.stdout).toContain("CYBARA SUBAGENTS");

    const spawn = await runCli(["subagent", "spawn", "compile release notes"]);
    expect(spawn.exitCode).toBe(0);
    expect(spawn.stdout).toContain("Spawned subagent: sub-2");

    const kill = await runCli(["subagent", "kill", "sub-2"]);
    expect(kill.exitCode).toBe(0);
    expect(kill.stdout).toContain("Killed subagent: sub-2");

    const mcpList = await runCli(["mcp", "list"]);
    expect(mcpList.exitCode).toBe(0);
    expect(mcpList.stdout).toContain("MCP SERVERS");
    expect(mcpList.stdout).toContain("Filesystem MCP");

    const mcpSearch = await runCli(["mcp", "search", "filesystem"]);
    expect(mcpSearch.exitCode).toBe(0);
    expect(mcpSearch.stdout).toContain("MCP REGISTRY SEARCH");
    expect(mcpSearch.stdout).toContain("filesystem");

    const mcpInstall = await runCli(["mcp", "install", "@modelcontextprotocol/server-git"]);
    expect(mcpInstall.exitCode).toBe(0);
    expect(mcpInstall.stdout).toContain("SUCCESS: Installed @modelcontextprotocol/server-git");

    const mcpPopular = await runCli(["mcp", "popular"]);
    expect(mcpPopular.exitCode).toBe(0);
    expect(mcpPopular.stdout).toContain("POPULAR MCP SERVERS");
  });

  test("usage and validation errors return non-zero for invalid args", async () => {
    const badMcpSearch = await runCli(["mcp", "search"]);
    expect(badMcpSearch.exitCode).toBe(1);
    expect(badMcpSearch.stderr).toContain("Usage: cybara mcp search <query>");

    const badPairPolicy = await runCli(["pair", "policy", "Discord Ops", "invalid-policy"]);
    expect(badPairPolicy.exitCode).toBe(1);
    expect(badPairPolicy.stderr).toContain("Invalid policy: invalid-policy");

    const badWalletSend = await runCli(["wallet", "send", "eth", "--to", "0xabc"]);
    expect(badWalletSend.exitCode).toBe(1);
    expect(badWalletSend.stderr).toContain("Usage: cybara wallet send");

    const badWalletSendToken = await runCli(["wallet", "send-token", "eth", "--to", "0xabc"]);
    expect(badWalletSendToken.exitCode).toBe(1);
    expect(badWalletSendToken.stderr).toContain("Usage: cybara wallet send-token");

    const badWalletSwap = await runCli(["wallet", "swap-eth-uniswap", "--token", "LINK"]);
    expect(badWalletSwap.exitCode).toBe(1);
    expect(badWalletSwap.stderr).toContain("Usage: cybara wallet swap-eth-uniswap");

    const badWalletContractCall = await runCli([
      "wallet",
      "contract-call",
      "--contract",
      "0x0000000000000000000000000000000000000001",
      "--method",
      "totalSupply",
    ]);
    expect(badWalletContractCall.exitCode).toBe(1);
    expect(badWalletContractCall.stderr).toContain("Usage: cybara wallet contract-call");

    const badWalletSolInstruction = await runCli([
      "wallet",
      "sol-instruction",
      "--program",
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      "--keys",
      '[{"pubkey":"11111111111111111111111111111111"}]',
      "--data-base64",
      "aGVsbG8=",
      "--data-utf8",
      "hello",
    ]);
    expect(badWalletSolInstruction.exitCode).toBe(1);
    expect(badWalletSolInstruction.stderr).toContain("Use only one instruction data encoding");

    const badWalletPrice = await runCli(["wallet", "price", "--source", "pyth"]);
    expect(badWalletPrice.exitCode).toBe(1);
    expect(badWalletPrice.stderr).toContain("Usage: cybara wallet price");

    const badWalletSwapQuote = await runCli(["wallet", "swap-quote", "--venue", "jupiter"]);
    expect(badWalletSwapQuote.exitCode).toBe(1);
    expect(badWalletSwapQuote.stderr).toContain("Jupiter venue requires --input-mint and --output-mint");
  });

  test("lsp list/install/uninstall commands are wired", async () => {
    const list = await runCli(["lsp", "list"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("LSP STATUS");
    expect(list.stdout).toContain("TypeScript");
    expect(list.stdout).toContain("python");

    const install = await runCli(["lsp", "install", "python"]);
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain("Successfully installed python");
    expect(install.stdout).toContain("/mock/lsp/python");

    const uninstall = await runCli(["lsp", "uninstall", "python"]);
    expect(uninstall.exitCode).toBe(0);
    expect(uninstall.stdout).toContain("Successfully uninstalled python");
  });

  test("missing required args return non-zero for pair/subagent/lsp", async () => {
    const badPairReject = await runCli(["pair", "reject"]);
    expect(badPairReject.exitCode).toBe(1);
    expect(badPairReject.stderr).toContain("Usage: cybara pair reject <CODE>");

    const badSubagentSpawn = await runCli(["subagent", "spawn"]);
    expect(badSubagentSpawn.exitCode).toBe(1);
    expect(badSubagentSpawn.stderr).toContain("ERROR: Please specify a task");

    const badLspInstall = await runCli(["lsp", "install"]);
    expect(badLspInstall.exitCode).toBe(1);
    expect(badLspInstall.stderr).toContain("ERROR: Please specify a language to install");
  });

  test("status exits non-zero when API is unreachable", async () => {
    const { exitCode, stderr } = await runCli(["status"], { CYBARA_API: "http://127.0.0.1:0" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Failed to connect to Cybara server");
  });
});
