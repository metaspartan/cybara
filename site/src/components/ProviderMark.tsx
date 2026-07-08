interface ProviderMarkProps {
  mark: string;
}

export function ProviderMark({ mark }: ProviderMarkProps): React.ReactElement {
  const common = {
    width: 26,
    height: 26,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false,
  } as const;

  switch (mark) {
    case "openai":
      return (
        <svg {...common}>
          <path
            d="M12 3.2a4 4 0 0 1 3.46 2 4 4 0 0 1 2.54 6.8 4 4 0 0 1-3.46 6 4 4 0 0 1-6.92 0A4 4 0 0 1 6 11.99 4 4 0 0 1 8.54 5.2 4 4 0 0 1 12 3.2Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "anthropic":
      return (
        <svg {...common}>
          <path
            d="M9.1 4h2.3l4.4 16h-2.5l-.9-3.5H8l-.9 3.5H4.6L9.1 4Zm.15 4.2L8.5 14h3.1L10.9 8.2h-.1Z"
            fill="currentColor"
          />
        </svg>
      );
    case "google":
      return (
        <svg {...common}>
          <path
            d="M12 2c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7Z"
            fill="currentColor"
          />
        </svg>
      );
    case "xai":
      return (
        <svg {...common}>
          <path d="M4 4h3.4l12.6 16h-3.4L4 4Z" fill="currentColor" />
          <path d="M20 4h-3.2l-4 5.2 1.7 2.2L20 4ZM4 20h3.2l4-5.2-1.7-2.2L4 20Z" fill="currentColor" opacity="0.5" />
        </svg>
      );
    case "meta":
      return (
        <svg {...common}>
          <path
            d="M4 15c0-4 1.6-7 4-7 3 0 4.2 8 8 8 1.9 0 3-1.7 3-4s-1.1-4-3-4c-2.6 0-4.3 3.4-6.5 6"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      );
    case "mistral":
      return (
        <svg {...common}>
          <path d="M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z" fill="currentColor" opacity="0.35" />
          <path d="M4 5h4v4H4zM10 8h4v4h-4zM16 5h4v4h-4zM4 15h4v4H4zM16 15h4v4h-4z" fill="currentColor" />
        </svg>
      );
    case "deepseek":
      return (
        <svg {...common}>
          <path
            d="M3 9c3.5-.4 6 .8 8 3 1.4 1.6 3.4 2.4 6 2.2-1.6 2-3.8 2.9-6.4 2.4C6.9 18 4 14.5 3 9Z"
            fill="currentColor"
          />
          <circle cx="16.5" cy="7.5" r="1.3" fill="currentColor" />
        </svg>
      );
    case "moonshot":
      return (
        <svg {...common}>
          <path
            d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z"
            fill="currentColor"
          />
        </svg>
      );
    case "minimax":
      return (
        <svg {...common}>
          <path d="M4 19V6l4 6 4-6 4 6 4-6v13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "zhipu":
      return (
        <svg {...common}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9 9h6l-6 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "groq":
      return (
        <svg {...common}>
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
        </svg>
      );
    case "ollama":
      return (
        <svg {...common}>
          <path
            d="M8 20v-4c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5v4M8.5 12c-1-1.5-1-4 .3-5.6M15.5 12c1-1.5 1-4-.3-5.6M9 6.4c-.2-1.6.3-3 1-3.4M15 6.4c.2-1.6-.3-3-1-3.4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "openrouter":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="2" fill="currentColor" />
          <circle cx="19" cy="6" r="2" fill="currentColor" />
          <circle cx="19" cy="18" r="2" fill="currentColor" />
          <path d="M7 12h4M11 12l6-5.5M11 12l6 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "bedrock":
      return (
        <svg {...common}>
          <path d="M4 8l8-4 8 4-8 4-8-4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M4 13l8 4 8-4M4 8v5M20 8v5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
    case "azure":
      return (
        <svg {...common}>
          <path d="M10 4h5l5 16h-8l4-3-6-1 6-9-3-.5L6 20H4L10 4Z" fill="currentColor" />
        </svg>
      );
    case "mcp":
      return (
        <svg {...common}>
          <path d="M3 12l6-6M6 15l7.5-7.5a2.5 2.5 0 1 1 3.5 3.5L12 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M9 6a2.5 2.5 0 1 1 3.5 3.5L8 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}
