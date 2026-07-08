import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    const variants = {
      default: "glass-button",
      primary: "glass-button-primary",
      ghost: "text-gray-300 hover:text-white hover:bg-white/10",
      danger: "bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30",
    };

    const sizes = {
      sm: "px-3 py-1.5 text-sm",
      md: "px-4 py-2",
      lg: "px-6 py-3 text-lg",
    };

    return (
      <button
        ref={ref}
        className={cn(
          variants[variant],
          sizes[size],
          "inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-[#0a0a0f]",
          "cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
          className
        )}
        {...props}
      />
    );
  }
);

GlassButton.displayName = "GlassButton";
