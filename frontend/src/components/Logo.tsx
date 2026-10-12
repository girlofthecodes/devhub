import { cn } from "@/utils/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path
        d="M10 9h6.5a7 7 0 0 1 0 14H10z"
        fill="none"
        className="stroke-accent-fg"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="16" r="2" className="fill-accent-fg opacity-70" />
    </svg>
  );
}

export function Logo({ subtitle, collapsed = false }: { subtitle?: string; collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-fg">DevHub</span>
          {subtitle && <span className="text-[11px] text-muted">{subtitle}</span>}
        </span>
      )}
    </span>
  );
}
