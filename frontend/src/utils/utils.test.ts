import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/http";

import { formatRelative, initials } from "./format";
import { applyApiErrors } from "./forms";

describe("applyApiErrors", () => {
  it("attaches known fields and returns null", () => {
    const setError = vi.fn();
    const error = new ApiError(400, { code: "validation_error", detail: "x", fields: { email: ["Duplicado."] } });
    expect(applyApiErrors(error, setError, ["email"])).toBeNull();
    expect(setError).toHaveBeenCalledWith("email", { type: "server", message: "Duplicado." });
  });

  it("returns the general message when no field matches", () => {
    const error = new ApiError(400, { code: "last_admin", detail: "Debe existir un administrador." });
    expect(applyApiErrors(error, vi.fn(), ["email"])).toBe("Debe existir un administrador.");
  });

  it("handles unknown errors", () => {
    expect(applyApiErrors(new Error("boom"), vi.fn(), [])).toBe("Ocurrió un error inesperado.");
  });
});

describe("format helpers", () => {
  it("builds initials from names and e-mails", () => {
    expect(initials("Ana López")).toBe("AL");
    expect(initials("dev.ops@example.com")).toBe("DO");
  });

  it("formats relative dates", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(formatRelative(null)).toBe("Nunca");
    expect(formatRelative("2026-10-12T11:59:50Z", now)).toBe("hace un momento");
    expect(formatRelative("2026-10-12T10:00:00Z", now)).toBe("hace 2 horas");
  });
});
