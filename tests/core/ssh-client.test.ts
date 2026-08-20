import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Server } from "ssh2";
import { handleScp, handleSsh } from "../../src/core/tools/handlers/ssh";
import { copySshFile, runSshCommand } from "../../src/core/ssh/ssh-client";

const USER = "ghost";
const PASSWORD = "carsecret";

interface TestSshServer {
  host: string;
  port: number;
  files: Map<string, Buffer>;
  close: () => Promise<void>;
}

const activeServers: TestSshServer[] = [];

async function startTestSshServer(): Promise<TestSshServer> {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const hostKey = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
  const files = new Map<string, Buffer>();
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client
      .on("authentication", (ctx) => {
        if (ctx.method === "password" && ctx.username === USER && ctx.password === PASSWORD) {
          ctx.accept();
        } else {
          ctx.reject();
        }
      })
      .on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.on("exec", (acceptExec, _reject, info) => {
            const stream = acceptExec();
            const command = info.command;
            if (command.includes("hang")) return;
            if (command.includes("fail")) {
              stream.stderr.write("boom\n");
              stream.exit(7);
              stream.end();
              return;
            }
            stream.write(`executed:${command}\n`);
            stream.exit(0);
            stream.end();
          });
          session.on("sftp", (acceptSftp) => {
            const sftp = acceptSftp();
            sftp.on("OPEN", (reqID, filename, pflags) => {
              if (pflags & 0x8 || pflags & 0x10) {
                files.set(filename, Buffer.alloc(0));
              }
              sftp.handle(reqID, Buffer.from(filename));
            });
            sftp.on("READ", (reqID, handle, offset, len) => {
              const content = files.get(handle.toString());
              if (!content) {
                sftp.status(reqID, 2);
                return;
              }
              sftp.data(reqID, content.subarray(offset, offset + len));
            });
            sftp.on("WRITE", (reqID, handle, offset, data) => {
              const name = handle.toString();
              const existing = files.get(name) ?? Buffer.alloc(0);
              const next = Buffer.alloc(Math.max(existing.length, offset + data.length));
              existing.copy(next);
              data.copy(next, offset);
              files.set(name, next);
              sftp.status(reqID, 0);
            });
            sftp.on("CLOSE", (reqID) => sftp.status(reqID, 0));
            sftp.on("STAT", (reqID, path) => {
              const content = files.get(path);
              if (!content) {
                sftp.status(reqID, 2);
                return;
              }
              sftp.attrs(reqID, { size: content.length, mode: 0o100644 });
            });
            sftp.on("FSTAT", (reqID, handle) => {
              const content = files.get(handle.toString());
              if (!content) {
                sftp.status(reqID, 2);
                return;
              }
              sftp.attrs(reqID, { size: content.length, mode: 0o100644 });
            });
            sftp.on("REALPATH", (reqID, path) => {
              sftp.name(reqID, [{ filename: path, longname: "", attrs: {} }]);
            });
          });
        });
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const testServer: TestSshServer = {
    host: "127.0.0.1",
    port: address.port,
    files,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
  activeServers.push(testServer);
  return testServer;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server) await server.close();
  }
});

function connectionFor(server: TestSshServer): {
  host: string;
  port: number;
  username: string;
  password: string;
} {
  return { host: server.host, port: server.port, username: USER, password: PASSWORD };
}

describe("ssh client", () => {
  test("runs a remote command and returns stdout, stderr, and exit code", async () => {
    const server = await startTestSshServer();
    const result = await runSshCommand(connectionFor(server), {
      command: "uname -a",
      timeoutMs: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("executed:uname -a");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  test("captures stderr and non-zero exit codes", async () => {
    const server = await startTestSshServer();
    const result = await runSshCommand(connectionFor(server), {
      command: "fail",
      timeoutMs: 5_000,
    });
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("boom");
  });

  test("rejects with an authentication error for a wrong password", async () => {
    const server = await startTestSshServer();
    await expect(
      runSshCommand(
        { ...connectionFor(server), password: "wrong-password" },
        { command: "whoami", timeoutMs: 5_000 }
      )
    ).rejects.toThrow();
  });

  test("reports timedOut when the remote command exceeds the deadline", async () => {
    const server = await startTestSshServer();
    const result = await runSshCommand(connectionFor(server), {
      command: "hang",
      timeoutMs: 600,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  test("uploads a file over SFTP", async () => {
    const server = await startTestSshServer();
    const dir = mkdtempSync(join(tmpdir(), "cybara-ssh-"));
    const localPath = join(dir, "payload.txt");
    writeFileSync(localPath, "hello from the agent");
    const result = await copySshFile(connectionFor(server), {
      direction: "upload",
      localPath,
      remotePath: "/tmp/payload.txt",
      timeoutMs: 10_000,
    });
    expect(result.bytes).toBe("hello from the agent".length);
    expect(server.files.get("/tmp/payload.txt")?.toString()).toBe("hello from the agent");
  });

  test("downloads a file over SFTP", async () => {
    const server = await startTestSshServer();
    server.files.set("/remote/notes.txt", Buffer.from("remote content here"));
    const dir = mkdtempSync(join(tmpdir(), "cybara-ssh-"));
    const localPath = join(dir, "notes.txt");
    const result = await copySshFile(connectionFor(server), {
      direction: "download",
      localPath,
      remotePath: "/remote/notes.txt",
      timeoutMs: 10_000,
    });
    expect(result.bytes).toBe("remote content here".length);
    expect(readFileSync(localPath, "utf8")).toBe("remote content here");
  });
});

describe("ssh tool handlers", () => {
  test("ssh handler returns output and never leaks the password", async () => {
    const server = await startTestSshServer();
    const result = await handleSsh({
      host: server.host,
      port: server.port,
      username: USER,
      password: PASSWORD,
      command: "nvidia-smi",
      timeout_seconds: 10,
    });
    expect(result).toEqual(
      expect.objectContaining({
        output: "executed:nvidia-smi\n",
        exit_code: 0,
        timed_out: false,
      })
    );
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  test("ssh handler reports missing arguments", async () => {
    const result = await handleSsh({ host: "x", username: "u" });
    expect(JSON.stringify(result)).toContain("required");
  });

  test("scp handler uploads and returns transfer details", async () => {
    const server = await startTestSshServer();
    const dir = mkdtempSync(join(tmpdir(), "cybara-ssh-"));
    const localPath = join(dir, "up.txt");
    writeFileSync(localPath, "upload me");
    const result = await handleScp({
      host: server.host,
      port: server.port,
      username: USER,
      password: PASSWORD,
      direction: "upload",
      local_path: localPath,
      remote_path: "/tmp/up.txt",
      timeout_seconds: 10,
    });
    expect(result).toEqual(
      expect.objectContaining({
        transferred: true,
        direction: "upload",
        bytes: "upload me".length,
      })
    );
    expect(server.files.get("/tmp/up.txt")?.toString()).toBe("upload me");
  });
});
