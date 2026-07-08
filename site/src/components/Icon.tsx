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
  | "package";

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
      <path d="M14.5 5.5a3.5 3.5 0 0 0-4.7 4.4L4 15.7 8.3 20l5.8-5.8a3.5 3.5 0 0 0 4.4-4.7l-2.3 2.3-2.3-.6-.6-2.3z" />
    </>
  ),
  skills: (
    <>
      <path d="M12 3 4 7v6c0 4.4 3.4 7.3 8 8 4.6-.7 8-3.6 8-8V7z" />
      <path d="m9 12 2 2 4-4" />
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
      <path d="M12 3v18M3 8l9 4 9-4M3 16l9 4 9-4" />
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
    <>
      <path d="M16.36 1.43c0 1.13-.41 2.19-1.1 3.01-.84.98-2.19 1.75-3.32 1.66-.14-1.11.41-2.29 1.09-3.03.77-.85 2.12-1.49 3.33-1.64z" />
      <path d="M20.47 17.05c-.6 1.37-.88 1.98-1.64 3.19-1.07 1.68-2.58 3.79-4.45 3.8-1.66.02-2.08-1.09-4.34-1.08-2.25.02-2.72 1.1-4.38 1.08-1.87-.01-3.3-1.91-4.37-3.6-2.99-4.72-3.31-10.26-1.46-13.2 1.31-2.09 3.39-3.31 5.34-3.31 1.98 0 3.23 1.09 4.87 1.09 1.59 0 2.56-1.09 4.86-1.09 1.73 0 3.57.94 4.88 2.57-4.29 2.35-3.59 8.47.09 10.55z" />
    </>
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
