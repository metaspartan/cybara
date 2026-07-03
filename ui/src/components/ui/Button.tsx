import { cn } from "../../lib/utils";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline" | "glass";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  glow?: boolean;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  isLoading = false,
  leftIcon,
  rightIcon,
  className,
  disabled,
  glow = false,
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

  const variants = {
    primary:
      "bg-gradient-to-b from-[rgb(var(--accent-primary))] to-[rgba(var(--accent-primary),0.8)] focus:ring-2 focus:accent-ring border border-white/20 shadow-[0_4px_14px_rgba(var(--accent-primary),0.3)] hover:shadow-[0_6px_20px_rgba(var(--accent-primary),0.5)] hover:-translate-y-[1px] backdrop-blur-xl text-white relative overflow-hidden after:absolute after:inset-0 after:bg-gradient-to-b after:from-white/20 after:to-transparent after:opacity-0 hover:after:opacity-100",
    secondary:
      "bg-[rgba(var(--accent-primary),0.1)] border border-[rgba(var(--accent-primary),0.2)] hover:bg-[rgba(var(--accent-primary),0.15)] text-[rgb(var(--accent-primary))] hover:text-white transition-colors focus:ring-white/50 backdrop-blur-md",
    danger:
      "bg-gradient-to-b from-red-500/90 to-red-600/90 backdrop-blur-md border border-red-500/50 text-white hover:brightness-110 focus:ring-red-500 shadow-[0_4px_14px_rgba(239,68,68,0.3)] hover:shadow-[0_6px_20px_rgba(239,68,68,0.5)]",
    ghost: "text-gray-400 hover:text-white hover:bg-white/10 focus:ring-white/50",
    outline:
      "border border-[rgba(var(--accent-primary),0.3)] text-gray-300 hover:text-white hover:bg-[rgba(var(--accent-primary),0.1)] focus:ring-white/50 backdrop-blur-sm",
    glass: "glass-button text-white focus:ring-white/50 bg-gradient-to-b from-white/10 to-white/5",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-3 text-base",
  };

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], glow && "glow-pulse", className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {!isLoading && leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
}
