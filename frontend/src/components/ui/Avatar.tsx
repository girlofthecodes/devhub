import { cn } from "@/utils/cn";
import { initials } from "@/utils/format";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
