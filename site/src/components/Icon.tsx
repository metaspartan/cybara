export type IconName =
  | "orchestration"
  | "tools"
  | "skills"
  | "wallet"
  | "providers"
  | "control"
  | "desktop"
  | "apple"
  | "mobile"
  | "terminal"
  | "github"
  | "arrow"
  | "shield"
  | "check"
  | "spark"
  | "windows"
  | "linux"
  | "download"
  | "refresh"
  | "import"
  | "android"
  | "package"
  | "code"
  | "gauge"
  | "plug";

interface IconProps {
  name: IconName;
  className?: string;
}

const PATHS: Record<IconName, React.ReactNode> = {
  orchestration: (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5" cy="18" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
      <path d="M12 7.4 6.6 15.8M12 7.4l5.4 8.4M7.4 18h9.2" />
    </>
  ),
  tools: (
    <>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </>
  ),
  skills: (
    <>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.4" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.3" />
    </>
  ),
  providers: (
    <>
      <path d="m12 2 10 5-10 5L2 7z" />
      <path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
    </>
  ),
  control: (
    <>
      <circle cx="7" cy="7" r="2.6" />
      <circle cx="17" cy="17" r="2.6" />
      <path d="M9.6 7H20M4 17h9.4" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  apple: (
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
  ),
  mobile: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.4" />
      <path d="M11 18h2" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.4" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  github: (
    <>
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7 1 .7 2v3c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4 2.8 6.9 7 8 4.2-1.1 7-4 7-8V6z" />
    </>
  ),
  check: (
    <>
      <path d="m5 12 4.5 4.5L19 7" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </>
  ),
  windows: (
    <>
      <path d="M3 5.6 10.3 4.5v6.4H3zM10.3 12.4H3v6.4l7.3 1.1zM12 4.2 21 3v8h-9zM12 12.9h9v8l-9-1.3z" />
    </>
  ),
  linux: (
    <>
      <path d="M9 4.5c-1 1.4-1.2 3.4-1.2 5 0 2-1.6 3.4-2.3 5-.5 1.2.2 2.2 1.4 2.4 1 2 2.8 2.6 5.1 2.6s4.1-.6 5.1-2.6c1.2-.2 1.9-1.2 1.4-2.4-.7-1.6-2.3-3-2.3-5 0-1.6-.2-3.6-1.2-5A3.2 3.2 0 0 0 12 3a3.2 3.2 0 0 0-3 1.5z" />
      <path d="M10.4 8.2h.01M13.6 8.2h.01M10.6 11c.9.7 1.9.7 2.8 0" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 13a8 8 0 0 0 14 4.5L20 15" />
      <path d="M4 4v5h5M20 20v-5h-5" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
      <path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
    </>
  ),
  android: (
    <>
      <path d="M6 10a6 6 0 0 1 12 0" />
      <rect x="6" y="10" width="12" height="8" rx="2" />
      <path d="M8.5 6.4 7.2 4.4M15.5 6.4l1.3-2" />
      <path d="M9.7 8h.01M14.3 8h.01" />
      <path d="M9.5 18v2.2M14.5 18v2.2" />
      <path d="M4.5 11.5v3.5M19.5 11.5v3.5" />
    </>
  ),
  package: (
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="m4 7 8 4 8-4M12 11v10M8 5l8 4" />
    </>
  ),
  code: (
    <>
      <path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16" />
    </>
  ),
  gauge: (
    <>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </>
  ),
  plug: (
    <>
      <path d="M12 22v-5M9 8V2M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </>
  ),
};

export function Icon({ name, className }: IconProps): React.ReactElement {
  const filled = name === "apple" || name === "github" || name === "windows";
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
