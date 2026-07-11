import { useEffect } from "react";

export interface DocumentHead {
  title: string;
  description: string;
  canonical: string;
}

function setMetaByName(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaByProperty(property: string, content: string): void {
  const el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (el) el.setAttribute("content", content);
}

function setCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function useDocumentHead(head: DocumentHead): void {
  useEffect(() => {
    document.title = head.title;
    setMetaByName("description", head.description);
    setCanonical(head.canonical);
    setMetaByProperty("og:title", head.title);
    setMetaByProperty("og:description", head.description);
    setMetaByProperty("og:url", head.canonical);
    setMetaByName("twitter:title", head.title);
    setMetaByName("twitter:description", head.description);
  }, [head.title, head.description, head.canonical]);
}
