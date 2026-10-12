import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

import { Alert, Skeleton } from "./Feedback";

export interface PickerItem {
  id: string;
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}

interface PickerListProps {
  label: string;
  items: PickerItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: Error | null;
  emptyText?: string;
}

/** Single-select list (radiogroup) for picking an entity inside dialogs. */
export function PickerList({ label, items, selected, onSelect, loading, error, emptyText }: PickerListProps) {
  return (
    <div role="radiogroup" aria-label={label} className="max-h-60 space-y-1 overflow-y-auto">
      {loading ? (
        Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{emptyText ?? "Sin resultados."}</p>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={selected === item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
              selected === item.id ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2",
            )}
          >
            {item.leading}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
              {item.subtitle && <span className="block truncate text-xs text-muted">{item.subtitle}</span>}
            </span>
            {item.trailing}
          </button>
        ))
      )}
    </div>
  );
}
