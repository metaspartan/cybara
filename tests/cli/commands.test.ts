import { describe, expect, test } from "bun:test";
import { createCliCommandsFixture } from "./commands.fixture";

const fixture = createCliCommandsFixture();
const { runCli } = fixture;

describe("CLI Commands", () => {
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
    expect(stdout).toContain("gateway");
    expect(stdout).toContain("models");
    expect(stdout).toContain("completion");
    expect(stdout).toContain("channels");
    expect(stdout).toContain("plugin");
    expect(stdout).toContain("ide [path[:line]]");
    expect(stdout).toContain("security [scan] [path]");
  });

  test("status command renders health summary", async () => {
    const { exitCode, stdout } = await runCli(["status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA STATUS");
    expect(stdout).toContain("status: healthy");
    expect(stdout).toContain("SYSTEM MONITOR");
    expect(stdout).toContain("cpu: 12.3%");
    expect(stdout).toContain("memory: 55.5% used");
    expect(stdout).toContain("swap: 25.0% used");
    expect(stdout).toContain("HEALTH CHECKS");
  });

  test("legacy-compatible CLI aliases are wired", async () => {
    const health = await runCli(["health"]);
    expect(health.exitCode).toBe(0);
    expect(health.stdout).toContain("CYBARA STATUS");

    const gatewayStatus = await runCli(["gateway", "status"]);
    expect(gatewayStatus.exitCode).toBe(0);
    expect(gatewayStatus.stdout).toContain("status: healthy");

    const gatewayLogs = await runCli(["gateway", "logs", "--tail", "1"]);
    expect(gatewayLogs.exitCode).toBe(0);
    expect(gatewayLogs.stdout).toContain("CYBARA LOGS");
    expect(fixture.lastLogsLimit).toBe("1");

    const gatewayRestart = await runCli(["gateway", "restart"]);
    expect(gatewayRestart.exitCode).toBe(0);
    expect(gatewayRestart.stdout).toContain("Gateway restart requested");

    const models = await runCli(["models"]);
    expect(models.exitCode).toBe(0);
    expect(models.stdout).toContain("CYBARA PROVIDERS");

    const providerModels = await runCli(["model", "provider", "prov-1"]);
    expect(providerModels.exitCode).toBe(0);
    expect(providerModels.stdout).toContain("claude-sonnet");

    const pairing = await runCli(["pairing", "list"]);
    expect(pairing.exitCode).toBe(0);
    expect(pairing.stdout).toContain("PAIR42");

    const devices = await runCli(["devices"]);
    expect(devices.exitCode).toBe(0);
    expect(devices.stdout).toContain("CYBARA MOBILE DEVICES");

    const completion = await runCli(["completion", "bash"]);
    expect(completion.exitCode).toBe(0);
    expect(completion.stdout).toContain("complete -F _cybara_completion cybara");
    expect(completion.stdout).toContain('tui) opts="status metrics usage evals');
    expect(completion.stdout).toContain("--no-alt-screen");
    expect(completion.stdout).toContain("--scroll-step");
    expect(completion.stdout).toContain(" ide ");
    expect(completion.stdout).toContain(" security ");
    expect(completion.stdout).toContain(
      'security) opts="scan --agent --router --deep --working-tree --diff --path'
    );
  });

  test("metrics command renders usage summary", async () => {
    const { exitCode, stdout } = await runCli(["metrics"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA METRICS");
    expect(stdout).toContain("TOKEN USAGE");
    expect(stdout).toContain("total: 42");
  });

  test("metrics analysis command renders advanced token analytics", async () => {
    const { exitCode, stdout } = await runCli(["metrics", "analysis"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CYBARA TOKEN ANALYSIS");
    expect(stdout).toContain("input_to_output_ratio: 1.625:1");
    expect(stdout).toContain("hottest_window: Thu 14:00");
    expect(stdout).toContain("MODEL THOUGHT PROFILES");
    expect(stdout).toContain("gpt-5.2");
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
    expect(logs.stdout).toContain("channel");
    expect(fixture.lastLogsLimit).toBe("1");
  });

  test("artifacts and journey commands support readable and JSON output", async () => {
    const artifacts = await runCli(["artifacts"]);
    expect(artifacts.exitCode).toBe(0);
    expect(artifacts.stdout).toContain("ARTIFACTS (1)");
    expect(artifacts.stdout).toContain("Implementation Notes");

    const artifactJson = await runCli(["artifacts", "--json"]);
    expect(artifactJson.exitCode).toBe(0);
    expect(JSON.parse(artifactJson.stdout).artifacts).toHaveLength(1);

    const journey = await runCli(["journey"]);
    expect(journey.exitCode).toBe(0);
    expect(journey.stdout).toContain("1 skills · 1 memories · 2 total");
    expect(journey.stdout).toContain("Release workflow");

    const journeyJson = await runCli(["journey", "-j"]);
    expect(journeyJson.exitCode).toBe(0);
    expect(JSON.parse(journeyJson.stdout).events).toHaveLength(1);
  });

  test("chat pending CLI commands cover queue, list, steer, edit, delete, reorder, and stop", async () => {
    fixture.chatPendingRequests.length = 0;

    const queue = await runCli(["chat", "queue", "session-1", "queued follow-up"]);
    expect(queue.exitCode).toBe(0);
    expect(queue.stdout).toContain("Queued pending message");
    expect(queue.stdout).toContain("pending-1");

    const pending = await runCli(["chat", "pending", "session-1"]);
    expect(pending.exitCode).toBe(0);
    expect(pending.stdout).toContain("queued follow-up");

    const activityJson = JSON.stringify([
      {
        id: "activity-1",
        phase: "result",
        text: "Ran repo review before steering",
        timestamp: 1783015200000,
        toolName: "exec_command",
        toolCallId: "tool-1",
      },
    ]);
    const steer = await runCli([
      "chat",
      "steer",
      "session-1",
      "pending-1",
      "--activity-json",
      activityJson,
    ]);
    expect(steer.exitCode).toBe(0);
    expect(steer.stdout).toContain("Steered pending message");
    expect(steer.stdout).toContain("Persisted 1 pre-steer activities");

    const edit = await runCli(["chat", "edit", "session-1", "pending-1", "edited follow-up"]);
    expect(edit.exitCode).toBe(0);
    expect(edit.stdout).toContain("Updated pending message");
    expect(edit.stdout).toContain("edited follow-up");

    const reorder = await runCli(["chat", "reorder", "session-1", "pending-2", "pending-1"]);
    expect(reorder.exitCode).toBe(0);
    expect(reorder.stdout).toContain("Reordered pending messages");
    expect(reorder.stdout).toContain("pending-2");

    const deleted = await runCli(["chat", "delete", "session-1", "pending-1"]);
    expect(deleted.exitCode).toBe(0);
    expect(deleted.stdout).toContain("Deleted pending message");

    const stopped = await runCli(["chat", "stop", "session-1"]);
    expect(stopped.exitCode).toBe(0);
    expect(stopped.stdout).toContain("Stopped active run");

    expect(
      fixture.chatPendingRequests.map((request) => `${request.method} ${request.path}`)
    ).toEqual([
      "POST /api/chat",
      "GET /api/chat/sessions/session-1/pending",
      "POST /api/chat/sessions/session-1/pending/pending-1/steer",
      "PATCH /api/chat/sessions/session-1/pending/pending-1",
      "POST /api/chat/sessions/session-1/pending/reorder",
      "DELETE /api/chat/sessions/session-1/pending/pending-1",
      "POST /api/chat/sessions/session-1/stop",
    ]);
    expect(fixture.chatPendingRequests[0]?.body).toMatchObject({
      sessionId: "session-1",
      message: "queued follow-up",
      queueMode: "queue",
    });
    expect(fixture.chatPendingRequests[2]?.body).toMatchObject({
      processActivities: [{ text: "Ran repo review before steering", toolCallId: "tool-1" }],
    });
    expect(fixture.chatPendingRequests[4]?.body).toEqual({
      pendingMessageIds: ["pending-2", "pending-1"],
    });
  });

  test("agent command forwards model overrides and model-router sends", async () => {
    fixture.chatPendingRequests.length = 0;

    const override = await runCli([
      "agent",
      "--session",
      "session-1",
      "--agent",
      "agent-1",
      "--model",
      "gpt-cli-override",
      "review this workspace",
    ]);
    expect(override.exitCode).toBe(0);
    expect(fixture.chatPendingRequests.at(-1)?.body).toMatchObject({
      sessionId: "session-1",
      agentId: "agent-1",
      modelOverride: "gpt-cli-override",
      message: "review this workspace",
    });

    const router = await runCli([
      "agent",
      "--session",
      "session-1",
      "--agent",
      "agent-1",
      "--router",
      "route this prompt",
    ]);
    expect(router.exitCode).toBe(0);
    expect(fixture.chatPendingRequests.at(-1)?.body).toMatchObject({
      sessionId: "session-1",
      agentId: "agent-1",
      useModelRouter: true,
      message: "route this prompt",
    });
    expect(fixture.chatPendingRequests.at(-1)?.body).not.toHaveProperty("modelOverride");
  });

  test("plugin command group is wired", async () => {
    const list = await runCli(["plugin"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("CYBARA PLUGINS");
    expect(list.stdout).toContain("Acme Plugin");
    expect(list.stdout).toContain("status: enabled");

    const discover = await runCli(["plugin", "discover", "developer"]);
    expect(discover.exitCode).toBe(0);
    expect(discover.stdout).toContain("PLUGIN CATALOG");
    expect(discover.stdout).toContain("Developer Essentials");

    const disable = await runCli(["plugin", "disable", "acme-plugin"]);
    expect(disable.exitCode).toBe(0);
    expect(disable.stdout).toContain("Acme Plugin disabled");

    const validate = await runCli(["plugin", "validate", "/tmp/acme-plugin"]);
    expect(validate.exitCode).toBe(0);
    expect(validate.stdout).toContain("PLUGIN VALIDATION");
    expect(validate.stdout).toContain("valid: yes");

    const install = await runCli(["plugin", "install", "/tmp/acme-plugin"]);
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain("SUCCESS: Installed Acme Plugin");

    const remove = await runCli(["plugin", "remove", "acme-plugin"]);
    expect(remove.exitCode).toBe(0);
    expect(remove.stdout).toContain("Removed plugin: acme-plugin");

    const apps = await runCli(["plugin", "apps"]);
    expect(apps.exitCode).toBe(0);
    expect(apps.stdout).toContain("Google Workspace");
    expect(apps.stdout).toContain("read-only");
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
    expect(setTheme.stdout).toContain('Set theme = "teal"');

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

    const priceQuote = await runCli([
      "wallet",
      "price",
      "--source",
      "chainlink",
      "--symbol",
      "BTC",
    ]);
    expect(priceQuote.exitCode).toBe(0);
    expect(priceQuote.stdout).toContain("PRICE QUOTE");
    expect(priceQuote.stdout).toContain("pair: BTC/USD");
    expect(priceQuote.stdout).toContain("price: 123.45");

    const priceQuotePositional = await runCli(["wallet", "price", "BTC"]);
    expect(priceQuotePositional.exitCode).toBe(0);
    expect(priceQuotePositional.stdout).toContain("pair: BTC/USD");

    const dynamicSwapSimple = await runCli(["wallet", "swap", "LINK", "--amount-eth", "0.2"]);
    expect(dynamicSwapSimple.exitCode).toBe(0);
    expect(dynamicSwapSimple.stdout).toContain("SWAP RESULT");
    expect(dynamicSwapSimple.stdout).toContain("mode: quote-only");
    expect(dynamicSwapSimple.stdout).toContain("venue: uniswap_v3");

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

    const dynamicSwapSimpleExecute = await runCli([
      "wallet",
      "swap",
      "--venue",
      "jup",
      "--input-mint",
      "So11111111111111111111111111111111111111112",
      "--output-mint",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "--amount",
      "1.2",
      "--execute",
    ]);
    expect(dynamicSwapSimpleExecute.exitCode).toBe(0);
    expect(dynamicSwapSimpleExecute.stdout).toContain("mode: execute");
    expect(dynamicSwapSimpleExecute.stdout).toContain("venue: jupiter");

    const endpoints = await runCli(["wallet", "endpoints"]);
    expect(endpoints.exitCode).toBe(0);
    expect(endpoints.stdout).toContain("WALLET ENDPOINT DIRECTORY");
    expect(endpoints.stdout).toContain("chainlink_feed_registry");

    const dapps = await runCli(["wallet", "dapps"]);
    expect(dapps.exitCode).toBe(0);
    expect(dapps.stdout).toContain("WALLET DAPP ADAPTERS");
    expect(dapps.stdout).toContain("uniswap_v3");
    expect(dapps.stdout).toContain("jupiter");

    const rpcCall = await runCli([
      "wallet",
      "rpc-call",
      "eth",
      "--method",
      "eth_blockNumber",
      "--params",
      "[]",
      "--id",
      "7",
    ]);
    expect(rpcCall.exitCode).toBe(0);
    expect(rpcCall.stdout).toContain("RPC CALL RESULT");
    expect(rpcCall.stdout).toContain("method: eth_blockNumber");
    expect(rpcCall.stdout).toContain("id: 7");

    const dappCall = await runCli([
      "wallet",
      "dapp",
      "--adapter",
      "uniswap_v3",
      "--json",
      '{"action":"quote","pair":"ETH/USDC"}',
    ]);
    expect(dappCall.exitCode).toBe(0);
    expect(dappCall.stdout).toContain("DAPP RESULT");
    expect(dappCall.stdout).toContain('"adapter": "uniswap_v3"');

    const x402DryRun = await runCli([
      "wallet",
      "x402",
      "--url",
      "https://merchant.example/x402",
      "--network",
      "eip155:1",
      "--dry-run",
    ]);
    expect(x402DryRun.exitCode).toBe(0);
    expect(x402DryRun.stdout).toContain("X402 RESULT");
    expect(x402DryRun.stdout).toContain("attempted_payment: yes");
    expect(x402DryRun.stdout).toContain("paid: no");

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
      '{"allowNativeSend":true,"allowTokenSend":true,"allowEthSwaps":true,"allowDappInteraction":true,"allowX402Payments":true,"allowedDappHosts":["merchant.example"],"allowedX402Networks":["eip155:1"],"x402MaxAmountAtomic":"250000"}',
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

    const reveal = await runCli([
      "wallet",
      "reveal-seed",
      "--password",
      "supersecret123",
      "--confirm",
      "REVEAL",
    ]);
    expect(reveal.exitCode).toBe(0);
    expect(reveal.stdout).toContain("24-word seed phrase");
  }, 20000);

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

    const show = await runCli(["subagent", "show", "sub-2"]);
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("Release summary complete");
    expect(show.stdout).toContain("read · completed");

    const missing = await runCli(["subagent", "show", "missing"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Subagent not found");
    expect(missing.stdout).not.toContain("undefined");

    const wait = await runCli(["subagent", "wait", "sub-2", "--timeout", "1"]);
    expect(wait.exitCode).toBe(0);
    expect(wait.stdout).toContain("status: completed");
    expect(wait.stdout).toContain("Release summary complete");

    const kill = await runCli(["subagent", "kill", "sub-2"]);
    expect(kill.exitCode).toBe(0);
    expect(kill.stdout).toContain("Killed subagent: sub-2");

    const clear = await runCli(["subagent", "clear", "sub-2"]);
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain("Cleared subagent: sub-2");

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

  test("mobile connect creates a revocable QR-compatible device payload", async () => {
    const mobile = await runCli(
      [
        "mobile",
        "connect",
        "--name",
        "Test Gateway",
        "--device",
        "CLI Test Phone",
        "--url",
        fixture.apiBase,
        "--json",
      ],
      { CYBARA_API_KEY: "cybara_root_cli_test" }
    );

    expect(mobile.exitCode).toBe(0);
    const payload = JSON.parse(mobile.stdout) as {
      protocol?: string;
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      deviceId?: string;
    };
    expect(payload.protocol).toBe("cybara-mobile-connect-v1");
    expect(payload.name).toBe("Test Gateway");
    expect(payload.baseUrl).toBe(fixture.apiBase);
    expect(payload.apiKey).toBe("cybara_mobile_cli_test_token");
    expect(payload.apiKey).not.toBe("cybara_root_cli_test");
    expect(payload.deviceId).toBe("mobile-1");
  });

  test("mobile list/revoke/remove commands are wired", async () => {
    const list = await runCli(["mobile", "list"], {
      CYBARA_API_KEY: "cybara_root_cli_test",
    });
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("CYBARA MOBILE DEVICES");
    expect(list.stdout).toContain("mobile-1");
    expect(list.stdout).toContain("CLI Test Phone");

    const revoke = await runCli(["mobile", "revoke", "mobile-1"], {
      CYBARA_API_KEY: "cybara_root_cli_test",
    });
    expect(revoke.exitCode).toBe(0);
    expect(revoke.stdout).toContain("Revoked mobile device: CLI Test Phone");

    const remove = await runCli(["mobile", "remove", "mobile-1"], {
      CYBARA_API_KEY: "cybara_root_cli_test",
    });
    expect(remove.exitCode).toBe(0);
    expect(remove.stdout).toContain("Removed mobile device: mobile-1");
  });

  test("loop command group is wired", async () => {
    const list = await runCli(["loop", "list"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("CYBARA AGENT LOOPS");
    expect(list.stdout).toContain("loop-1");

    const start = await runCli(["loop", "start", "agent-1", "Draft incident report"]);
    expect(start.exitCode).toBe(0);
    expect(start.stdout).toContain("Started loop: loop-");

    const show = await runCli(["loop", "show", "loop-1"]);
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("CYBARA LOOP RUN");
    expect(show.stdout).toContain("loop-1");

    const cancel = await runCli(["loop", "cancel", "loop-1"]);
    expect(cancel.exitCode).toBe(0);
    expect(cancel.stdout).toContain("Cancellation requested: loop-1");
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
    expect(badWalletSwapQuote.stderr).toContain(
      "Jupiter venue requires --input-mint and --output-mint"
    );

    const badWalletSwapFlags = await runCli([
      "wallet",
      "swap",
      "LINK",
      "--amount-eth",
      "0.1",
      "--execute",
      "--quote-only",
    ]);
    expect(badWalletSwapFlags.exitCode).toBe(1);
    expect(badWalletSwapFlags.stderr).toContain("Use either --execute or --quote-only/--dry-run");
  }, 20000);

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

    const badLoopStart = await runCli(["loop", "start"]);
    expect(badLoopStart.exitCode).toBe(1);
    expect(badLoopStart.stderr).toContain("ERROR: Please specify an agent ID");
  });

  test("status exits non-zero when API is unreachable", async () => {
    const { exitCode, stderr } = await runCli(["status"], {
      CYBARA_API: "http://127.0.0.1:0",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Failed to connect to Cybara server");
  });
});
