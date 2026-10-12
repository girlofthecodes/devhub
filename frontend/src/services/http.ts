import axios, { AxiosError } from "axios";

import type { ApiErrorBody, FieldErrors } from "@/types/api";

export const CSRF_COOKIE = "devhub_csrftoken";
const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

/** Normalized error thrown by every service call. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.detail ?? "Error inesperado.");
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? "error";
    this.fields = body.fields ?? {};
  }

  get isUnauthenticated(): boolean {
    return this.code === "not_authenticated" || this.status === 401;
  }
}

export function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}

export const http = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  timeout: 15000,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
});

http.interceptors.request.use((config) => {
  if (config.method && UNSAFE_METHODS.has(config.method.toLowerCase())) {
    const token = readCookie(CSRF_COOKIE);
    if (token) config.headers.set("X-CSRFToken", token);
  }
  return config;
});

type UnauthenticatedListener = () => void;
const listeners = new Set<UnauthenticatedListener>();

/** Subscribe to "session expired / revoked" events coming from any API call. */
export function onUnauthenticated(listener: UnauthenticatedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<Partial<ApiErrorBody>>) => {
    if (error.response) {
      const apiError = new ApiError(error.response.status, error.response.data ?? {});
      if (apiError.isUnauthenticated) listeners.forEach((fn) => fn());
      return Promise.reject(apiError);
    }
    const message =
      error.code === "ECONNABORTED"
        ? "El servidor tardó demasiado en responder."
        : "No se pudo conectar con el servidor.";
    return Promise.reject(new ApiError(0, { code: "network_error", detail: message }));
  },
);

let csrfReady: Promise<void> | null = null;

/** Make sure the CSRF cookie exists before the first unsafe request (e.g. login). */
export function ensureCsrf(): Promise<void> {
  if (readCookie(CSRF_COOKIE)) return Promise.resolve();
  csrfReady ??= http
    .get("/auth/csrf/")
    .then(() => undefined)
    .finally(() => {
      csrfReady = null;
    });
  return csrfReady;
}
