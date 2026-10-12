import { cn } from "@/utils/cn";
import { initials } from "@/utils/format";

const SIZES = { sm: "size-9 text-xs rounded-lg", md: "size-12 text-sm rounded-xl", lg: "size-16 text-lg rounded-2xl" };

/** Project logo, or a deterministic monogram tile when there is none. */
export function ProjectLogo({
  name,
  url,
  size = "md",
  className,
}: {
  name: string;
  url: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={`Logotipo de ${name}`}
        className={cn("shrink-0 border border-border bg-surface object-cover", SIZES[size], className)}
      />
    );
  }
  const hue = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))` }}
      className={cn("flex shrink-0 items-center justify-center font-semibold text-white", SIZES[size], className)}
    >
      {initials(name)}
    </span>
  );
}
