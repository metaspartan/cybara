import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  hover?: boolean;
  glass?: boolean;
  variant?: 'default' | 'liquid' | 'solid';
}

export function Card({ children, className, hover = false, glass = true, variant = 'liquid', ...props }: CardProps) {
  const variants = {
    default: 'bg-white/5 backdrop-blur-xl border-white/10',
    liquid: 'glass-card',
    solid: 'bg-[#13131a] border-white/10',
  };

  return (
    <div
      className={cn(
        'rounded-2xl',
        glass && variants[variant],
        !glass && 'border border-white/10',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-4 sm:px-5 py-3 border-b border-white/10', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-lg font-semibold text-white', className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-gray-400 mt-1', className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-4 sm:p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-4 sm:px-5 py-3 border-t border-white/10 flex items-center gap-3', className)} {...props}>
      {children}
    </div>
  );
}
