import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function run(home: string, source: string): Promise<string> {
  const subprocess = Bun.spawn([process.execPath, "-e", source], {
    cwd: join(import.meta.dir, "..", ".."),
    env: { ...Bun.env, CYBARA_HOME: home, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr || stdout);
  return stdout;
}

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), "cybara-secret-storage-"));
  homes.push(home);
  return home;
}

describe("credential storage", () => {
  test("authenticates ciphertext and binds it to its storage context", async () => {
    const home = temporaryHome();
    const output = await run(
      home,
      `
        const storage = await import("./src/core/secret-storage.ts");
        const sealed = storage.sealSecret("provider-token", "provider:p1:api_key");
        let wrongContext = false;
        let tampered = false;
        try { storage.openSecret(sealed, "provider:p2:api_key"); } catch { wrongContext = true; }
        try { storage.openSecret(sealed.slice(0, -1) + (sealed.endsWith("A") ? "B" : "A"), "provider:p1:api_key"); } catch { tampered = true; }
        console.log(JSON.stringify({ sealed, opened: storage.openSecret(sealed, "provider:p1:api_key"), wrongContext, tampered }));
      `
    );
    const result = JSON.parse(output.trim()) as {
      sealed: string;
      opened: string;
      wrongContext: boolean;
      tampered: boolean;
    };

    expect(result.sealed).toStartWith("cybara-secret:v1:");
    expect(result.opened).toBe("provider-token");
    expect(result.wrongContext).toBe(true);
    expect(result.tampered).toBe(true);
    expect(readFileSync(join(home, "secure", "storage.key"))).toHaveLength(32);
    if (process.platform !== "win32") {
      expect(statSync(join(home, "secure", "storage.key")).mode & 0o777).toBe(0o600);
    }
  });

  test("encrypts database credentials and returns plaintext only through typed tables", async () => {
    const home = temporaryHome();
    const output = await run(
      home,
      `
        const { tables } = await import("./src/core/database.ts");
        const { Database } = await import("bun:sqlite");
        tables.providers.create({ id: "p1", provider: "openai", name: "OpenAI", api_key: "api-secret", access_token: "access-secret", refresh_token: "refresh-secret", is_default: true });
        tables.channels.create({ id: "c1", type: "discord", name: "Discord", config: { bot_token: "channel-secret" }, enabled: true });
        tables.mcpServers.create({ id: "m1", name: "Remote", command: "", env: "AUTHORIZATION=Bearer mcp-secret", enabled: true });
        const db = new Database(process.env.CYBARA_HOME + "/data/platform.db");
        const provider = db.query("SELECT api_key, access_token, refresh_token FROM providers WHERE id='p1'").get();
        const channel = db.query("SELECT config FROM channels WHERE id='c1'").get();
        const mcp = db.query("SELECT env FROM mcp_servers WHERE id='m1'").get();
        db.close();
        console.log("RESULT=" + JSON.stringify({ provider, channel, mcp, openedProvider: tables.providers.get("p1"), openedChannel: tables.channels.get("c1"), openedMcp: tables.mcpServers.get("m1") }));
      `
    );
    const marker = output
      .trim()
      .split("\n")
      .find((line) => line.startsWith("RESULT="));
    expect(marker).toBeDefined();
    const result = JSON.parse(marker?.slice("RESULT=".length) ?? "{}") as Record<string, unknown>;
    expect(JSON.stringify(result.provider)).not.toContain("api-secret");
    expect(JSON.stringify(result.channel)).not.toContain("channel-secret");
    expect(JSON.stringify(result.mcp)).not.toContain("mcp-secret");
    expect(result.openedProvider).toMatchObject({ api_key: "api-secret" });
    expect(result.openedChannel).toMatchObject({
      config: JSON.stringify({ bot_token: "channel-secret" }),
    });
    expect(result.openedMcp).toMatchObject({ env: "AUTHORIZATION=Bearer mcp-secret" });
  });

  test("migrates existing plaintext database credentials on startup", async () => {
    const home = temporaryHome();
    await run(
      home,
      `
        await import("./src/core/database.ts");
        const { Database } = await import("bun:sqlite");
        const db = new Database(process.env.CYBARA_HOME + "/data/platform.db");
        db.query("INSERT INTO providers (id, provider, name, api_key, is_default) VALUES (?, ?, ?, ?, ?)").run("legacy-provider", "openai", "Legacy", "legacy-api-key", 0);
        db.query("INSERT INTO channels (id, type, name, config, enabled) VALUES (?, ?, ?, ?, ?)").run("legacy-channel", "discord", "Legacy", JSON.stringify({ bot_token: "legacy-bot-token" }), 1);
        db.close();
      `
    );
    const output = await run(
      home,
      `
        const { tables } = await import("./src/core/database.ts");
        const { Database } = await import("bun:sqlite");
        const db = new Database(process.env.CYBARA_HOME + "/data/platform.db");
        const rawProvider = db.query("SELECT api_key FROM providers WHERE id='legacy-provider'").get();
        const rawChannel = db.query("SELECT config FROM channels WHERE id='legacy-channel'").get();
        db.close();
        console.log("RESULT=" + JSON.stringify({ rawProvider, rawChannel, provider: tables.providers.get("legacy-provider"), channel: tables.channels.get("legacy-channel") }));
      `
    );
    const marker = output
      .trim()
      .split("\n")
      .find((line) => line.startsWith("RESULT="));
    const result = JSON.parse(marker?.slice("RESULT=".length) ?? "{}") as Record<string, unknown>;

    expect(JSON.stringify(result.rawProvider)).not.toContain("legacy-api-key");
    expect(JSON.stringify(result.rawChannel)).not.toContain("legacy-bot-token");
    expect(result.provider).toMatchObject({ api_key: "legacy-api-key" });
    expect(result.channel).toMatchObject({
      config: JSON.stringify({ bot_token: "legacy-bot-token" }),
    });
  });
});
