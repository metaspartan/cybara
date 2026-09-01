import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const temporaryDirectories: string[] = [];
const originalFetch = globalThis.fetch;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

afterEach(() => {
  config.set("tool_approval_mode", "ask");
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("agent provider vision routing", () => {
  test("feeds image tool output back to custom vision models", async () => {
    config.set("tool_approval_mode", "always_allow");
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);
      if (requestBodies.length === 1) {
        return Response.json({
          id: "custom-vision-tool-response",
          object: "chat.completion",
          model: "custom-vision-model",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "custom-vision-image-call",
                    type: "function",
                    function: {
                      name: "image",
                      arguments: JSON.stringify({
                        image: `${process.cwd()}/cybara.png`,
                        prompt: "Inspect this image",
                        extractText: false,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({
        id: "custom-vision-final-response",
        object: "chat.completion",
        model: "custom-vision-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "I can inspect the returned image directly." },
          },
        ],
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai",
      name: "Custom Vision Provider",
      api_key: "custom-vision-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Custom Vision Agent",
      type: "main",
      provider_id: provider.id,
      model: "custom-vision-model",
      config: { image_input: "enabled" },
      tools: [
        {
          name: "image",
          description: "Inspect an image",
          input_schema: {
            type: "object",
            properties: {
              image: { type: "string" },
              prompt: { type: "string" },
              extractText: { type: "boolean" },
            },
            required: ["image", "prompt"],
          },
        },
      ],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Inspect the project mascot." }],
      { useTools: true, useMemory: false, sessionId: "custom-vision-tool-session" }
    );

    expect(result.content).toBe("I can inspect the returned image directly.");
    expect(requestBodies).toHaveLength(2);
    const followupMessages = requestBodies[1].messages as Array<Record<string, unknown>>;
    const imageFollowup = followupMessages.find(
      (message) => message.role === "user" && Array.isArray(message.content)
    );
    expect(JSON.stringify(imageFollowup)).toContain("data:image/png;base64,");
  });

  test("lets a vision agent list a directory and inspect an image with read", async () => {
    config.set("tool_approval_mode", "always_allow");
    const directory = mkdtempSync(join(tmpdir(), "cybara-vision-directory-"));
    temporaryDirectories.push(directory);
    const imagePath = join(directory, "design.png");
    await Bun.write(imagePath, tinyPng);
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);
      if (requestBodies.length === 1) {
        return Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "list-images",
                    type: "function",
                    function: { name: "read", arguments: JSON.stringify({ path: directory }) },
                  },
                ],
              },
            },
          ],
        });
      }
      if (requestBodies.length === 2) {
        return Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "inspect-image",
                    type: "function",
                    function: { name: "read", arguments: JSON.stringify({ path: imagePath }) },
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({
        choices: [{ message: { role: "assistant", content: "The directory image is visible." } }],
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai",
      name: "Directory Vision Provider",
      api_key: "directory-vision-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Directory Vision Agent",
      type: "main",
      provider_id: provider.id,
      model: "directory-vision-model",
      config: { image_input: "enabled" },
      tools: [
        {
          name: "read",
          description: "Read a file or directory",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: `Look through the images in ${directory}.` }],
      { useTools: true, useMemory: false, sessionId: "directory-vision-session" }
    );

    expect(result.content).toBe("The directory image is visible.");
    expect(requestBodies).toHaveLength(3);
    const finalMessages = requestBodies[2]?.messages as Array<Record<string, unknown>>;
    expect(JSON.stringify(finalMessages)).toContain("data:image/png;base64,");
  });
});
