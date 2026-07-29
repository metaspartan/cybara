import { afterEach, describe, expect, test } from "bun:test";
import { connect, createServer, type Server } from "net";
import { buildConnector } from "undici";
import {
  createPublicHttpConnector,
  fetchPublicHttpUrl,
  isPrivateOrBlockedIp,
} from "../../src/core/outbound-url-policy";

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

describe("outbound URL connected-peer policy", () => {
  test("recognizes private and mapped loopback addresses", () => {
    expect(isPrivateOrBlockedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrBlockedIp("1.1.1.1")).toBe(false);
  });

  test("rejects a private peer even when the requested hostname is public", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");

    const localConnector: ReturnType<typeof buildConnector> = (_options, callback) => {
      const socket = connect(address.port, "127.0.0.1");
      socket.once("connect", () => callback(null, socket));
      socket.once("error", (error) => callback(error, null));
    };
    const guardedConnector = createPublicHttpConnector(localConnector);
    const error = await new Promise<Error>((resolve, reject) => {
      guardedConnector(
        {
          hostname: "public.example",
          host: "public.example",
          protocol: "http:",
          port: "80",
        },
        (connectionError, socket) => {
          socket?.destroy();
          if (connectionError) resolve(connectionError);
          else reject(new Error("Private peer was accepted"));
        }
      );
    });

    expect(error.message).toContain("Blocked connected address");
  });

  test("rejects private URL shapes before opening a connection", async () => {
    await expect(fetchPublicHttpUrl("http://127.0.0.1:4269/private")).rejects.toThrow(
      "Blocked hostname"
    );
  });
});
