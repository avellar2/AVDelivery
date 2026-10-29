import Link from "next/link";

import { cn } from "@/lib/utils";

export function Brand({
  href = "/",
  compact = false,
  className,
}: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-orange-600 text-sm font-bold text-white shadow-sm">
        AV
      </span>
      {compact ? null : (
        <span className="text-sm font-semibold tracking-tight text-zinc-900">AV Delivery</span>
      )}
    </Link>
  );
}
