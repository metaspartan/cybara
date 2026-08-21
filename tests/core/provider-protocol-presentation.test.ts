import { describe, expect, test } from "bun:test";
import {
  presentProviderProtocolText,
  PROVIDER_PROTOCOL_RECOVERY_MESSAGE,
} from "../../shared/provider-protocol";

describe("provider protocol presentation", () => {
  test("replaces the malformed tool payload observed in a persisted inference turn", () => {
    const raw =
      "<｜DSML｜tool:string:1400 malformed transport payload\n\nThis is a transport string.";

    expect(presentProviderProtocolText(raw)).toEqual({
      content: PROVIDER_PROTOCOL_RECOVERY_MESSAGE,
      protocolRemoved: true,
    });
  });

  test("preserves visible prose around a complete protocol block", () => {
    const raw = [
      "Checking the project.",
      "<||DSML||tool_call>",
      "internal payload",
      "</||DSML||tool_call>",
      "The review is complete.",
    ].join("\n");

    expect(presentProviderProtocolText(raw)).toEqual({
      content: "Checking the project.\n\nThe review is complete.",
      protocolRemoved: true,
    });
  });

  test("does not alter ordinary assistant text", () => {
    expect(presentProviderProtocolText("The review is complete.")).toEqual({
      content: "The review is complete.",
      protocolRemoved: false,
    });
  });
});
