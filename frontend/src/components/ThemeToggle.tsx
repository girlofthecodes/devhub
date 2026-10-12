import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { cn } from "@/utils/cn";

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Tema claro", icon: Sun },
  { value: "dark", label: "Tema oscuro", icon: Moon },
  { value: "system", label: "Tema del sistema", icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn("inline-flex rounded-lg border border-border bg-surface-2 p-0.5", className)}
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:text-fg",
            preference === value && "bg-surface text-fg shadow-xs",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
