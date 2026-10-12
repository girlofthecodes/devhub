import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "@/services/http";

/**
 * Maps backend validation errors onto react-hook-form fields.
 * Returns the message that could not be attached to a field (to show as a form alert).
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) return "Ocurrió un error inesperado.";
  let attached = false;
  for (const [name, messages] of Object.entries(error.fields)) {
    if ((fields as readonly string[]).includes(name) && messages?.length) {
      setError(name as Path<T>, { type: "server", message: messages.join(" ") });
      attached = true;
    }
  }
  return attached ? null : error.message;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}
