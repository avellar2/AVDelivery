import { cn } from "@/lib/utils";

export type BadgeVariant = "neutral" | "success" | "warning" | "muted" | "brand";

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "border-zinc-200 bg-zinc-100 text-zinc-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  muted: "border-zinc-200 bg-white text-zinc-500",
  brand: "border-orange-200 bg-orange-50 text-orange-700",
};

export function Badge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
