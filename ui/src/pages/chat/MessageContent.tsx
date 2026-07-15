import { Check, Copy } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { chatMarkdownImageSrc } from "@/lib/chatImages";
import { preprocessChatMarkdown } from "@/lib/chatMarkdownPreprocessor";
import { cn } from "@/lib/utils";
import { MermaidCodeBlock } from "./MermaidCodeBlock";

function transformChatMarkdownUrl(url: string): string {
  return chatMarkdownImageSrc(url) ?? defaultUrlTransform(url);
}

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  md: "markdown",
  yml: "yaml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  csharp: "c",
  plain: "plaintext",
  text: "plaintext",
};

function extractTextContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => extractTextContent(child)).join("");
  }
  if (isValidElement(node)) {
    return extractTextContent((node.props as { children?: unknown }).children);
  }
  return "";
}

function normalizeCodeLanguage(rawLanguage?: string): string {
  if (!rawLanguage) return "plaintext";
  const key = rawLanguage.trim().toLowerCase();
  return CODE_LANGUAGE_ALIASES[key] || key || "plaintext";
}

function looksLikeDiffCode(code: string, language: string): boolean {
  if (language === "diff" || language === "patch") {
    return true;
  }
  const previewLines = code.split(/\r?\n/).slice(0, 12);
  return previewLines.some((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("diff --git") ||
      trimmed.startsWith("@@") ||
      trimmed.startsWith("+++ ") ||
      trimmed.startsWith("--- ")
    );
  });
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (error) {
      console.error("Failed to copy code block:", error);
    }
  }, [code]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[12px] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
      title={copied ? "Copied" : "Copy code"}
      aria-label={copied ? "Copied code block" : "Copy code block"}
    >
      {copied ? (
        <>
          <Check className="w-3 h-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          Copy
        </>
      )}
    </button>
  );
}

function InlineCodeSnippet({
  code,
  className,
  codeProps,
}: {
  code: string;
  className?: string;
  codeProps?: ComponentPropsWithoutRef<"code">;
}) {
  return (
    <code
      className={cn(
        "inline rounded-md border border-white/15 bg-white/[0.07] px-1.5 py-0.5 align-baseline font-mono text-[0.85em] text-indigo-100 whitespace-normal break-words",
        className
      )}
      {...codeProps}
    >
      {code}
    </code>
  );
}

export function DiffCodeBlock({ code, fill = false }: { code: string; fill?: boolean }) {
  const lines = code.split(/\r?\n/);

  const lineMeta = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("diff --git") || trimmed.startsWith("index ")) {
      return {
        prefix: "·",
        rowClass: "bg-white/[0.02]",
        numberClass: "text-gray-500",
        markerClass: "text-gray-400",
        textClass: "text-gray-300",
      };
    }
    if (trimmed.startsWith("@@") || trimmed.startsWith("+++ ") || trimmed.startsWith("--- ")) {
      return {
        prefix: "↕",
        rowClass: "bg-blue-500/10",
        numberClass: "text-blue-300/80",
        markerClass: "text-blue-300",
        textClass: "text-blue-200",
      };
    }
    if (line.startsWith("+")) {
      return {
        prefix: "+",
        rowClass: "bg-green-500/12",
        numberClass: "text-green-300/80",
        markerClass: "text-green-300",
        textClass: "text-green-200",
      };
    }
    if (line.startsWith("-")) {
      return {
        prefix: "−",
        rowClass: "bg-red-500/12",
        numberClass: "text-red-300/80",
        markerClass: "text-red-300",
        textClass: "text-red-200",
      };
    }
    return {
      prefix: " ",
      rowClass: "",
      numberClass: "text-gray-500",
      markerClass: "text-gray-400",
      textClass: "text-gray-300",
    };
  });

  return (
    <div
      className={cn(
        "chat-code-block flex min-h-0 min-w-0 flex-col overflow-hidden border border-white/10 bg-slate-950/70",
        fill ? "h-full rounded-none border-0" : "my-3 rounded-xl"
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] uppercase tracking-[0.08em] text-gray-400">
        <span>diff</span>
        <CopyCodeButton code={code} />
      </div>
      <div className="min-h-0 min-w-0 flex-1 touch-pan-x overflow-auto overscroll-contain">
        <div className="min-w-max font-mono text-[11px] leading-6 sm:text-[12px]">
          {lines.map((line, index) => (
            <div
              key={`diff-${index}`}
              className={cn(
                "grid w-max min-w-full grid-cols-[48px_20px_max-content] items-start px-2",
                lineMeta[index]?.rowClass
              )}
            >
              <span
                className={cn(
                  "select-none pr-2 text-right text-[12px]",
                  lineMeta[index]?.numberClass
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn("select-none text-center text-[12px]", lineMeta[index]?.markerClass)}
              >
                {lineMeta[index]?.prefix}
              </span>
              <span className={cn("whitespace-pre", lineMeta[index]?.textClass)}>
                {line || "\u00A0"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SyntaxCodeBlock({ code, language }: { code: string; language: string }) {
  const displayLanguage = language === "plaintext" ? "text" : language;
  const lineCount = code ? code.split(/\r?\n/).length : 0;
  return (
    <div className="chat-code-block my-3 overflow-hidden rounded-xl border border-white/10 bg-black/55 shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] uppercase tracking-[0.08em] text-gray-400">
        <span className="inline-flex items-center gap-2">
          <span>{displayLanguage}</span>
          <span className="text-[10px] normal-case tracking-normal text-gray-500">
            {lineCount} lines
          </span>
        </span>
        <CopyCodeButton code={code} />
      </div>
      <Highlight theme={themes.nightOwl} code={code || " "} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(className, "m-0 overflow-x-auto p-3 text-[12px] leading-6")}
            style={{ ...style, background: "transparent" }}
          >
            {tokens.map((line, lineIndex) => (
              <div key={`line-${lineIndex}`} {...getLineProps({ line })}>
                {line.length > 0
                  ? line.map((token, tokenIndex) => (
                      <span key={`${lineIndex}-${tokenIndex}`} {...getTokenProps({ token })} />
                    ))
                  : "\u00A0"}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

export function MessageContent({
  content,
  onOpenImage,
}: {
  content: string;
  onOpenImage?: (src: string, alt: string) => void;
}) {
  type MarkdownPreProps = ComponentPropsWithoutRef<"pre">;
  type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { inline?: boolean };
  const cleanedContent = useMemo(() => preprocessChatMarkdown(content), [content]);

  return (
    <div className="chat-markdown max-w-none text-gray-200">
      <ReactMarkdown
        urlTransform={transformChatMarkdownUrl}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { output: "htmlAndMathml", strict: "warn", throwOnError: false, trust: false },
          ],
        ]}
        components={{
          pre: ({ children }: MarkdownPreProps) => <>{children}</>,
          code({ className, children, inline, ...props }: MarkdownCodeProps) {
            const rawCode = extractTextContent(children).replace(/\n$/, "");
            const inferredInline = !className && !rawCode.includes("\n");
            if (inline ?? inferredInline) {
              return <InlineCodeSnippet code={rawCode} className={className} codeProps={props} />;
            }

            const languageMatch = className ? /language-([^\s]+)/.exec(className) : null;
            const language = normalizeCodeLanguage(languageMatch?.[1]);
            if (language === "mermaid") {
              return (
                <MermaidCodeBlock
                  code={rawCode}
                  codeView={<SyntaxCodeBlock code={rawCode} language="plaintext" />}
                />
              );
            }
            if (looksLikeDiffCode(rawCode, language)) {
              return <DiffCodeBlock code={rawCode} />;
            }

            return <SyntaxCodeBlock code={rawCode} language={language} />;
          },
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03]">
              <table className="chat-code-text w-full border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-white/10 last:border-b-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="text-left font-semibold text-gray-100 px-3 py-2 align-top">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="px-3 py-2 align-top text-gray-300">{children}</td>,
          h1: ({ children }) => <h1 className="text-xl font-bold mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-bold mb-2">{children}</h3>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-indigo-400 hover:text-indigo-300 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const source = typeof src === "string" ? src : "";
            const imageSource = chatMarkdownImageSrc(source);
            if (!imageSource) return null;
            return (
              <button
                type="button"
                onClick={() => onOpenImage?.(imageSource, alt || "Image")}
                data-chat-lightbox-src={imageSource}
                data-chat-lightbox-alt={alt || "Image"}
                className="block my-2 cursor-zoom-in"
                aria-label={`Open ${alt || "image"} preview`}
              >
                <img
                  src={imageSource}
                  alt={alt || "image"}
                  loading="lazy"
                  className="max-h-80 max-w-full rounded-lg border border-white/12 object-contain"
                />
              </button>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-indigo-500 pl-3 my-2 text-gray-400">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="border-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-4" />
          ),
        }}
      >
        {cleanedContent}
      </ReactMarkdown>
    </div>
  );
}
