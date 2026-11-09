import type {
  LanguageModelV3,
  LanguageModelV3FilePart,
  LanguageModelV3Prompt,
  LanguageModelV3Text,
  LanguageModelV3TextPart,
} from "@ai-sdk/provider";
import type { AgentMessage } from "../agent";
import type { Provider } from "../database";
import { resolveImage, type AgentImage } from "./image-blocks";

type CursorLanguageModel = Pick<LanguageModelV3, "doGenerate">;

export type CursorSdkFactory = (options: {
  name: string;
  accessToken?: string;
  apiKey?: string;
  workspaceRoot?: string;
}) => { languageModel: (modelId: string) => CursorLanguageModel };

export type CursorSdkTransportOptions = {
  sdk: CursorSdkFactory;
  abortSignal?: AbortSignal;
};

function cursorImagePart(
  image: AgentImage
): { type: "file"; data: string; mediaType: string } | undefined {
  const { data, url, mimeType } = resolveImage(image);
  if (data) return { type: "file", data, mediaType: mimeType };
  if (url && /^https?:\/\//i.test(url)) return { type: "file", data: url, mediaType: mimeType };
  return undefined;
}

export function cursorSdkPrompt(messages: AgentMessage[]): LanguageModelV3Prompt {
  const prompt: LanguageModelV3Prompt = [];
  const textMessage = (text: string): LanguageModelV3TextPart => ({ type: "text", text });
  for (const message of messages) {
    const text = message.content.trim();
    const imageParts: LanguageModelV3FilePart[] = (message.images ?? []).flatMap((image) => {
      const part = cursorImagePart(image);
      return part ? [part] : [];
    });
    if (message.role === "tool") {
      if (text) prompt.push({ role: "user", content: [textMessage(`TOOL\n${text}`)] });
      continue;
    }
    if (message.role === "system") {
      if (text) prompt.push({ role: "system", content: text });
      continue;
    }
    const content: Array<LanguageModelV3TextPart | LanguageModelV3FilePart> = [];
    if (text) content.push(textMessage(text));
    content.push(...imageParts);
    if (content.length) prompt.push({ role: message.role, content });
  }
  return prompt;
}

export async function callCursorSdkTransport(
  provider: Provider,
  model: string,
  messages: AgentMessage[],
  options: CursorSdkTransportOptions
): Promise<{ content: string }> {
  const credential = provider.api_key || provider.access_token;
  if (!credential) throw new Error(`No credential available for ${provider.provider}`);
  const sdk = options.sdk({
    name: "cybara",
    ...(provider.access_token
      ? { accessToken: provider.access_token }
      : { apiKey: provider.api_key ?? "" }),
  });
  const languageModel = sdk.languageModel(model);
  const result = await languageModel.doGenerate({
    prompt: cursorSdkPrompt(messages),
    abortSignal: options.abortSignal,
  });
  const content = result.content
    .filter((part): part is LanguageModelV3Text => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) throw new Error("Cursor returned an empty response");
  return { content };
}
