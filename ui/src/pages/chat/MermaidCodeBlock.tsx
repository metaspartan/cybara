import { AlertTriangle } from "lucide-react";
import mermaid from "mermaid";
import { type ReactNode, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

type MermaidView = "preview" | "code";

interface MermaidCodeBlockProps {
  code: string;
  codeView: ReactNode;
}

export function MermaidCodeBlock({ code, codeView }: MermaidCodeBlockProps) {
  const generatedId = useId();
  const [view, setView] = useState<MermaidView>("preview");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [lightTheme, setLightTheme] = useState(() =>
    document.documentElement.classList.contains("light")
  );

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setLightTheme(root.classList.contains("light"));
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme-mode"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const render = async () => {
      setError("");
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: lightTheme ? "default" : "dark",
          flowchart: { htmlLabels: false, useMaxWidth: true },
        });
        const id = `chat-mermaid-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const rendered = await mermaid.render(id, code);
        if (active) setSvg(rendered.svg);
      } catch (renderError) {
        if (!active) return;
        setSvg("");
        setError(renderError instanceof Error ? renderError.message : "Diagram could not render");
      }
    };
    void render();
    return () => {
      active = false;
    };
  }, [code, generatedId, lightTheme]);

  return (
    <div className="my-3 min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[var(--surface-panel,#11131c)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-[var(--surface-raised,#1a1d24)] px-2 py-1.5">
        <span className="px-1 text-[11px] uppercase tracking-[0.08em] text-gray-500">Mermaid</span>
        <div className="inline-flex items-center rounded-md bg-black/20 p-0.5" role="tablist">
          {(["preview", "code"] as MermaidView[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              onClick={() => setView(item)}
              className={cn(
                "rounded px-2 py-1 text-[11px] capitalize transition-colors",
                view === item ? "bg-white/10 text-gray-100" : "text-gray-500 hover:text-gray-200"
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {view === "code" ? (
        <div className="[&>div]:my-0 [&>div]:rounded-none [&>div]:border-0">{codeView}</div>
      ) : (
        <div className="flex min-h-40 items-center justify-center overflow-auto p-4">
          {error ? (
            <div className="flex max-w-lg items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-3">{error}</span>
            </div>
          ) : svg ? (
            <div
              className="mermaid-preview min-w-0 max-w-full [&_svg]:h-auto [&_svg]:max-h-[560px] [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="text-xs text-gray-500">Rendering diagram...</div>
          )}
        </div>
      )}
    </div>
  );
}
