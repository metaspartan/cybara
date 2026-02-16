import { describe, expect, test } from "bun:test";
import path from "path";
import { cybaraDir } from "../../src/core/paths";
import {
  getDefaultWhatsAppAuthPath,
  getTelegramInboundMediaDir,
} from "../../src/core/channels/paths";

describe("Channel storage paths", () => {
  test("telegram inbound media directory is under ~/.cybara", () => {
    expect(getTelegramInboundMediaDir()).toBe(path.join(cybaraDir, "media", "inbound"));
  });

  test("whatsapp auth path is channel-scoped under ~/.cybara", () => {
    expect(getDefaultWhatsAppAuthPath("channel-123")).toBe(
      path.join(cybaraDir, "channels", "whatsapp-auth", "channel-123")
    );
  });
});
