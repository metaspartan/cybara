export interface IrcLine {
  prefix: string | null;
  command: string;
  params: string[];
}

export interface IrcPrivmsg {
  senderNick: string;
  target: string;
  text: string;
}

export function parseIrcLine(raw: string): IrcLine | null {
  let line = raw.replace(/\r?\n$/, "");
  if (!line) return null;

  let prefix: string | null = null;
  if (line.startsWith(":")) {
    const space = line.indexOf(" ");
    if (space === -1) return null;
    prefix = line.slice(1, space);
    line = line.slice(space + 1);
  }

  const params: string[] = [];
  let trailing: string | null = null;
  const trailingIdx = line.indexOf(" :");
  if (line.startsWith(":")) {
    trailing = line.slice(1);
    line = "";
  } else if (trailingIdx !== -1) {
    trailing = line.slice(trailingIdx + 2);
    line = line.slice(0, trailingIdx);
  }

  const tokens = line.split(" ").filter((t) => t.length > 0);
  const command = tokens.shift() || "";
  params.push(...tokens);
  if (trailing !== null) params.push(trailing);

  if (!command) return null;
  return { prefix, command: command.toUpperCase(), params };
}

export function nickFromPrefix(prefix: string | null): string {
  if (!prefix) return "";
  const bang = prefix.indexOf("!");
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

export function parsePrivmsg(line: IrcLine): IrcPrivmsg | null {
  if (line.command !== "PRIVMSG" || line.params.length < 2) return null;
  return {
    senderNick: nickFromPrefix(line.prefix),
    target: line.params[0],
    text: line.params[1],
  };
}

export function isPing(line: IrcLine): string | null {
  if (line.command !== "PING") return null;
  return line.params[0] || "";
}
