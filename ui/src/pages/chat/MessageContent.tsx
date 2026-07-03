import {
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { Highlight, themes } from "prism-react-renderer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { preprocessChatMarkdown } from "@/lib/chatMarkdownPreprocessor";
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

export function DiffCodeBlock({ code }: { code: string }) {
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
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] uppercase tracking-[0.08em] text-gray-400">
        <span>diff</span>
        <CopyCodeButton code={code} />
      </div>
      <pre className="m-0 overflow-x-auto font-mono text-[12px] leading-6">
        {lines.map((line, index) => (
          <div
            key={`diff-${index}`}
            className={cn(
              "grid grid-cols-[48px_20px_minmax(0,1fr)] items-start px-2",
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
      </pre>
    </div>
  );
}

function SyntaxCodeBlock({ code, language }: { code: string; language: string }) {
  const displayLanguage = language === "plaintext" ? "text" : language;
  const lineCount = code ? code.split(/\r?\n/).length : 0;
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-black/55 shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
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

export function MessageContent({ content }: { content: string }) {
  type MarkdownPreProps = ComponentPropsWithoutRef<"pre">;
  type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { inline?: boolean };
  const cleanedContent = useMemo(() => preprocessChatMarkdown(content), [content]);

  return (
    <div className="max-w-none text-[12px] text-gray-200 leading-[1.45rem]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
              <table className="w-full text-[12px] border-collapse">{children}</table>
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
