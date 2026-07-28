const TOP_LEVEL_COMMANDS = [
  "--no-alt-screen",
  "--no-mouse",
  "--scroll-step",
  "acp",
  "agent",
  "agents",
  "artifacts",
  "browser",
  "channels",
  "chat",
  "completion",
  "config",
  "configure",
  "connector",
  "devices",
  "doctor",
  "gateway",
  "health",
  "help",
  "ide",
  "journey",
  "loop",
  "logs",
  "lsp",
  "mcp",
  "memory",
  "metrics",
  "migrate",
  "mobile",
  "model",
  "models",
  "onboard",
  "pair",
  "pairing",
  "plugin",
  "plugins",
  "provider",
  "providers",
  "router",
  "sessions",
  "setup",
  "skills",
  "start",
  "status",
  "subagent",
  "subagents",
  "tasks",
  "tui",
  "update",
  "version",
  "wallet",
  "wizard",
];

const SUBCOMMANDS: Record<string, string[]> = {
  doctor: ["--deep", "--json", "--export"],
  gateway: ["status", "health", "logs", "restart", "start", "run"],
  provider: ["list", "available", "add", "update", "delete", "models", "discover"],
  providers: ["list", "available", "add", "update", "delete", "models", "discover"],
  model: ["list", "provider"],
  models: ["list", "provider"],
  mobile: ["connect", "devices", "list", "revoke", "remove"],
  devices: ["connect", "list", "revoke", "remove"],
  pair: ["list", "reject", "policy"],
  pairing: ["list", "reject", "policy"],
  connector: ["list", "configure", "connect", "disconnect", "setup"],
  connectors: ["list", "configure", "connect", "disconnect", "setup"],
  mcp: ["list", "add", "search", "install", "popular", "serve"],
  plugin: [
    "list",
    "validate",
    "install",
    "remove",
    "apps",
    "configure",
    "connect",
    "disconnect",
    "setup",
  ],
  plugins: [
    "list",
    "validate",
    "install",
    "remove",
    "apps",
    "configure",
    "connect",
    "disconnect",
    "setup",
  ],
  loop: ["list", "start", "show", "cancel"],
  wallet: [
    "status",
    "create",
    "import",
    "unlock",
    "lock",
    "accounts",
    "balances",
    "tokens",
    "tx",
    "send",
    "send-token",
    "price",
    "swap",
    "agent-policy",
    "rpc",
  ],
  lsp: ["list", "install", "uninstall"],
  logs: ["--tail", "-n", "--follow", "-f"],
  tui: [
    "status",
    "metrics",
    "usage",
    "evals",
    "providers",
    "router",
    "channels",
    "memory",
    "tools",
    "browser",
    "wallet",
    "chat",
    "sessions",
    "logs",
    "mobile",
    "mcp",
    "lsp",
    "subagents",
    "artifacts",
    "journey",
    "settings",
    "--no-alt-screen",
    "--alt-screen",
    "--no-mouse",
    "--mouse",
    "--scroll-step",
  ],
};

function shellWords(words: string[]): string {
  return words.join(" ");
}

export function printCompletion(shell = "zsh"): void {
  const normalized = shell.toLowerCase();
  const commands = shellWords(TOP_LEVEL_COMMANDS);
  const cases = Object.entries(SUBCOMMANDS)
    .map(([command, subs]) => `    ${command}) opts="${shellWords(subs)}" ;;`)
    .join("\n");

  if (normalized === "bash") {
    console.log(`_cybara_completion() {
  local cur prev cmd opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    opts="${commands}"
  else
    case "\${cmd}" in
${cases}
      *) opts="" ;;
    esac
  fi
  COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
}
complete -F _cybara_completion cybara`);
    return;
  }

  console.log(`#compdef cybara
_cybara() {
  local -a commands subcommands
  commands=(${commands})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "$words[2]" in
${cases}
      *) opts="" ;;
  esac
  subcommands=(\${=opts})
  _describe 'subcommand' subcommands
}
_cybara "$@"`);
}
