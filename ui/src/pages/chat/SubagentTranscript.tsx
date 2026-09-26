import { ChatImageLightbox, type ChatLightboxImage } from "./ChatImageLightbox";
import { useState, type ReactElement } from "react";
import type { ChatMessage } from "@/types";
import { chatImageSrc } from "@/lib/chatImages";
import type { ChatLinkOpenOptions } from "./chatLinkRouting";
import { ChatImagePreview } from "./ChatImagePreview";
import { MessageContent } from "./MessageContent";

export function SubagentTranscript({
  messages,
  onOpenLink,
}: {
  messages: ChatMessage[];
  onOpenLink: (href: string, options: ChatLinkOpenOptions) => boolean;
}): ReactElement {
  const [lightbox, setLightbox] = useState<ChatLightboxImage | null>(null);
  return (
    <>
      {lightbox && (
        <ChatImageLightbox images={[lightbox]} initialIndex={0} onClose={() => setLightbox(null)} />
      )}
      {messages.map((message, index) => (
        <article
          key={message.message_id ?? `${message.timestamp ?? "message"}:${index}`}
          className="rounded border border-white/10 p-2 text-sm"
        >
          <p className="mb-1 text-xs text-gray-400">{message.role}</p>
          {message.thinking && (
            <details>
              <summary>Thinking</summary>
              <MessageContent content={message.thinking} onOpenLink={onOpenLink} />
            </details>
          )}
          <MessageContent content={message.content} onOpenLink={onOpenLink} />
          {message.tool_calls?.map((tool, toolIndex) => (
            <details key={tool.id ?? `${tool.name}:${toolIndex}`}>
              <summary>
                {tool.name} · {tool.status}
              </summary>
              {tool.arguments !== undefined && (
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(tool.arguments, null, 2)}
                </pre>
              )}
              {tool.result !== undefined && (
                <pre className="whitespace-pre-wrap break-words">
                  {typeof tool.result === "string"
                    ? tool.result
                    : JSON.stringify(tool.result, null, 2)}
                </pre>
              )}
              {tool.error && <p role="alert">{tool.error}</p>}
            </details>
          ))}
          {message.images?.map((image, imageIndex) => {
            const source = chatImageSrc(image);
            return source ? (
              <ChatImagePreview
                key={`${source}:${imageIndex}`}
                source={source}
                width={320}
                height={240}
                containerClassName="max-w-full"
                onOpen={(src, alt) => setLightbox({ src, alt })}
                alt={image.name ?? "Transcript attachment"}
                className="max-h-64 max-w-full object-contain"
              />
            ) : null;
          })}
        </article>
      ))}
    </>
  );
}
