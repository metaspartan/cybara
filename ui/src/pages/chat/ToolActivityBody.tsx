import { memo, useState } from "react";
import { DiffCodeBlock } from "./MessageContent";

const DIFF_PREVIEW_LINES = 300;
const ARGS_PREVIEW_LINES = 200;

export function leadingLines(text: string, maxLines: number): { text: string; total: number } {
  let offset = 0;
  let count = 0;
  let cut = -1;
  while (offset <= text.length) {
    count += 1;
    if (count === maxLines + 1) cut = offset - 1;
    const next = text.indexOf("\n", offset);
    if (next === -1) break;
    offset = next + 1;
  }
  return cut < 0 ? { text, total: count } : { text: text.slice(0, cut), total: count };
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid="activity-copy-button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="chat-meta-text cursor-pointer rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
      {children}
    </span>
  );
}

function ToolDiffBody({ diff }: { diff: string }) {
  const [showAll, setShowAll] = useState(false);
  const preview = leadingLines(diff, DIFF_PREVIEW_LINES);
  const truncated = !showAll && preview.text.length < diff.length;
  return (
    <div data-testid="activity-diff-body">
      <DiffCodeBlock code={truncated ? preview.text : diff} className="my-1.5" />
      {truncated ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="chat-meta-text mb-1 cursor-pointer text-indigo-300 hover:text-indigo-200"
        >
          Show all {preview.total} lines
        </button>
      ) : null}
    </div>
  );
}

function ToolArgsBody({ args }: { args: string }) {
  const [showAll, setShowAll] = useState(false);
  const preview = leadingLines(args, ARGS_PREVIEW_LINES);
  const truncated = !showAll && preview.text.length < args.length;
  return (
    <div data-testid="activity-args-body">
      <div className="mb-1 flex items-center justify-between gap-2">
        <SectionLabel>Arguments</SectionLabel>
        <CopyButton value={args} label="arguments" />
      </div>
      <pre
        data-testid="activity-args-code"
        className="chat-code-surface max-h-80 overflow-auto whitespace-pre rounded-lg border border-white/10 px-3 py-2 font-mono text-[12px] leading-5 text-gray-300"
      >
        {truncated ? preview.text : args}
      </pre>
      {truncated ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="chat-meta-text mb-1 mt-1 cursor-pointer text-indigo-300 hover:text-indigo-200"
        >
          Show all {preview.total} lines
        </button>
      ) : null}
    </div>
  );
}

function ToolOutputBody({ output }: { output: string }) {
  return (
    <div data-testid="activity-output-body">
      <div className="mb-1 flex items-center justify-between gap-2">
        <SectionLabel>Output</SectionLabel>
        <CopyButton value={output} label="output" />
      </div>
      <pre className="chat-code-surface max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 px-3 py-2 font-mono text-[12px] leading-5 text-gray-300">
        {output}
      </pre>
    </div>
  );
}

export const ToolActivityBody = memo(function ToolActivityBody({
  args,
  output,
  diff,
}: {
  args?: string;
  output?: string;
  diff?: string;
}) {
  return (
    <div className="space-y-2">
      {args ? <ToolArgsBody args={args} /> : null}
      {diff ? <ToolDiffBody diff={diff} /> : null}
      {!diff && output ? <ToolOutputBody output={output} /> : null}
    </div>
  );
});
