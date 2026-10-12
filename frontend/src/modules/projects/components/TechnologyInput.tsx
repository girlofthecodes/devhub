import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { cn } from "@/utils/cn";

import { TECH_PATTERN } from "../schemas";

interface Props {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  suggestions?: string[];
  invalid?: boolean;
  max?: number;
  describedBy?: string;
}

/** Chip input: Enter or comma adds a technology, Backspace on empty input removes the last. */
export function TechnologyInput({ id, value, onChange, suggestions = [], invalid, max = 20, describedBy }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  function add(raw: string) {
    const tech = raw.replace(/\s+/g, " ").trim().replace(/,$/, "");
    if (!tech) return;
    if (!TECH_PATTERN.test(tech) || tech.length > 40) {
      setError("Usa letras, números y . # + - / (máx. 40).");
      return;
    }
    if (value.some((v) => v.toLowerCase() === tech.toLowerCase())) {
      setDraft("");
      return;
    }
    if (value.length >= max) {
      setError(`Máximo ${max} tecnologías.`);
      return;
    }
    onChange([...value, tech]);
    setDraft("");
    setError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-ring",
          invalid || error ? "border-red-500" : "border-border-strong",
        )}
      >
        {value.map((tech) => (
          <span key={tech} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {tech}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== tech))}
              aria-label={`Quitar ${tech}`}
              className="opacity-70 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          list={listId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          aria-describedby={describedBy}
          placeholder={value.length ? "" : "React, Django, PostgreSQL…"}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm text-fg outline-none placeholder:text-muted/70"
        />
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
