import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export function fitAndNotifyTerminal(
  terminal: Terminal,
  fitAddon: FitAddon,
  socket: WebSocket | null,
  previous: TerminalDimensions | null
): TerminalDimensions {
  fitAddon.fit();
  const next = { cols: terminal.cols, rows: terminal.rows };
  if (
    socket?.readyState === WebSocket.OPEN &&
    (previous?.cols !== next.cols || previous.rows !== next.rows)
  ) {
    socket.send(`\u001b[RESIZE:${next.cols},${next.rows}]`);
  }
  return next;
}
