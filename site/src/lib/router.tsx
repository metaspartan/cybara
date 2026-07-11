import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const NAVIGATE_EVENT = "cybara:navigate";

export function normalizePath(path: string): string {
  if (!path) return "/";
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function usePath(): string {
  const [path, setPath] = useState<string>(() =>
    typeof window === "undefined" ? "/" : normalizePath(window.location.pathname)
  );

  useEffect(() => {
    const sync = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, []);

  return path;
}

export function navigate(to: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(to, window.location.origin);
  if (url.origin !== window.location.origin) {
    window.location.href = to;
    return;
  }
  const samePath = normalizePath(url.pathname) === normalizePath(window.location.pathname);
  window.history.pushState({}, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  if (url.hash) {
    const target = document.getElementById(url.hash.slice(1));
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (samePath) return;
  }
  window.scrollTo({ top: 0, behavior: samePath ? "smooth" : "auto" });
}

export function A({
  href,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (
      !href ||
      !href.startsWith("/") ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
