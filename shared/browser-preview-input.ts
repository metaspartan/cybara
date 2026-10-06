export type BrowserPointerButton = 0 | 1 | 2;

export const BROWSER_POINTER_BUTTONS: readonly BrowserPointerButton[] = [0, 1, 2];

export function normalizeBrowserPointerButton(value: unknown): BrowserPointerButton {
  return value === 1 || value === 2 ? value : 0;
}

export function isPreviewPointerButton(value: number): boolean {
  return value === 0 || value === 1 || value === 2;
}

export type BrowserPreviewInput =
  | { type: "scroll"; deltaX: number; deltaY: number }
  | { type: "pointer_click"; x: number; y: number; button: BrowserPointerButton }
  | { type: "pointer_move"; x: number; y: number }
  | { type: "pointer_down"; x: number; y: number; button: BrowserPointerButton }
  | { type: "pointer_up"; x: number; y: number; button: BrowserPointerButton }
  | { type: "keyboard"; key: string }
  | { type: "text"; text: string };

export function browserPreviewInputAction(input: BrowserPreviewInput): string {
  if (input.type === "pointer_click") return "pointer/click";
  if (input.type === "pointer_move") return "pointer/move";
  if (input.type === "pointer_down") return "pointer/down";
  if (input.type === "pointer_up") return "pointer/up";
  return input.type;
}

export function browserPreviewInputBody(
  input: BrowserPreviewInput
): Record<string, unknown> {
  if (input.type === "scroll") return { deltaX: input.deltaX, deltaY: input.deltaY };
  if (input.type === "keyboard") return { key: input.key };
  if (input.type === "text") return { text: input.text };
  if (input.type === "pointer_move") return { x: input.x, y: input.y };
  return { x: input.x, y: input.y, button: normalizeBrowserPointerButton(input.button) };
}
