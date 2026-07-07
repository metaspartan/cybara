import { describe, expect, test, afterEach } from "bun:test";
import { createServer, type Server } from "net";
import { sendSmtp } from "../../src/core/channels/adapters/email";

interface FakeServer {
  server: Server;
  port: number;
  received: string[];
}

function startFakeSmtp(opts: { advertiseStartTls: boolean }): Promise<FakeServer> {
  return new Promise((resolve) => {
    const received: string[] = [];
    const server = createServer((socket) => {
      let inData = false;
      let authStep = 0;
      let buf = "";
      socket.setEncoding("utf8");
      socket.write("220 fake-smtp ready\r\n");
      socket.on("data", (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          received.push(line);
          if (inData) {
            if (line === ".") {
              inData = false;
              socket.write("250 queued\r\n");
            }
            continue;
          }
          const upper = line.toUpperCase();
          if (upper.startsWith("EHLO")) {
            socket.write(
              opts.advertiseStartTls
                ? "250-hello\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n"
                : "250-hello\r\n250 AUTH LOGIN\r\n"
            );
          } else if (upper.startsWith("AUTH LOGIN")) {
            authStep = 1;
            socket.write("334 VXNlcm5hbWU6\r\n");
          } else if (authStep === 1) {
            authStep = 2;
            socket.write("334 UGFzc3dvcmQ6\r\n");
          } else if (authStep === 2) {
            authStep = 0;
            socket.write("235 authenticated\r\n");
          } else if (upper.startsWith("MAIL FROM")) {
            socket.write("250 ok\r\n");
          } else if (upper.startsWith("RCPT TO")) {
            socket.write("250 ok\r\n");
          } else if (upper === "DATA") {
            inData = true;
            socket.write("354 go ahead\r\n");
          } else if (upper === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else if (upper === "STARTTLS") {
            socket.write("220 go\r\n");
          } else {
            socket.write("235 ok\r\n");
          }
        }
      });
      socket.on("error", () => void 0);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port, received });
    });
  });
}

let current: FakeServer | null = null;

describe("SMTP cleartext credential protection", () => {
  afterEach(() => {
    current?.server.close();
    current = null;
  });

  test("refuses to send credentials when server lacks STARTTLS and insecure is disabled", async () => {
    current = await startFakeSmtp({ advertiseStartTls: false });
    const ok = await sendSmtp({
      host: "127.0.0.1",
      port: current.port,
      username: "user@example.com",
      password: "s3cret-password",
      from: "user@example.com",
      to: "dest@example.com",
      subject: "t",
      body: "hi",
      allowInsecure: false,
    });
    expect(ok).toBe(false);
    const wire = current.received.join("\n");
    expect(wire).not.toContain("AUTH LOGIN");
    expect(wire).not.toContain(Buffer.from("s3cret-password").toString("base64"));
  });

  test("proceeds over plaintext only when insecure is explicitly allowed", async () => {
    current = await startFakeSmtp({ advertiseStartTls: false });
    const ok = await sendSmtp({
      host: "127.0.0.1",
      port: current.port,
      username: "user@example.com",
      password: "s3cret-password",
      from: "user@example.com",
      to: "dest@example.com",
      subject: "t",
      body: "hi",
      allowInsecure: true,
    });
    expect(ok).toBe(true);
    expect(current.received.join("\n")).toContain("AUTH LOGIN");
  });
});
