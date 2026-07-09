import { useEffect, useRef } from "react";
import { type IdeActionId, bindingFromEvent, resolveKeymap } from "./ideKeymap";

type IdeHotkeyHandlers = Partial<Record<IdeActionId, () => void>>;

interface UseIdeHotkeysOptions {
  overrides: Record<string, string>;
  enabled?: boolean;
}

// Global IDE shell shortcuts. Editor-local keys (save, find, go-to-line) stay in
// the editor component; this only fires shell actions and always allows the few
// combos that should work even while typing (they all use a modifier).
export function useIdeHotkeys(handlers: IdeHotkeyHandlers, options: UseIdeHotkeysOptions): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const overridesRef = useRef(options.overrides);
  overridesRef.current = options.overrides;
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Every shell binding requires a modifier, so we don't steal plain typing.
      if (!event.metaKey && !event.ctrlKey && !event.altKey) return;
      const binding = bindingFromEvent(event);
      const keymap = resolveKeymap(overridesRef.current);
      for (const action of Object.keys(handlersRef.current) as IdeActionId[]) {
        if (keymap[action] && keymap[action] === binding) {
          const handler = handlersRef.current[action];
          if (handler) {
            event.preventDefault();
            event.stopPropagation();
            handler();
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
