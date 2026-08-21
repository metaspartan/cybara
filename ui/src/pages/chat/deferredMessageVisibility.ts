const deferredMessageCallbacks = new Map<Element, () => void>();
let deferredMessageObserver: IntersectionObserver | null = null;

function getDeferredMessageObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") {
    return null;
  }
  if (deferredMessageObserver) return deferredMessageObserver;
  deferredMessageObserver = new window.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const reveal = deferredMessageCallbacks.get(entry.target);
        if (!reveal) continue;
        deferredMessageCallbacks.delete(entry.target);
        deferredMessageObserver?.unobserve(entry.target);
        reveal();
      }
    },
    { rootMargin: "1800px 0px" }
  );
  return deferredMessageObserver;
}

export function observeDeferredMessage(element: Element, reveal: () => void): () => void {
  const observer = getDeferredMessageObserver();
  if (!observer) {
    reveal();
    return () => undefined;
  }
  deferredMessageCallbacks.set(element, reveal);
  observer.observe(element);
  return () => {
    deferredMessageCallbacks.delete(element);
    observer.unobserve(element);
  };
}
