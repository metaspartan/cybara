import { cn } from "../../lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md";
}

export function Badge({
  children,
  variant = "default",
  size = "sm",
  className,
  ...props
}: BadgeProps) {
  const variants = {
    default: "bg-white/5 text-gray-300 border-white/10 hover:bg-white/10",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
    error: "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-sm",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full border backdrop-blur-md transition-all duration-200 glass-chip",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
