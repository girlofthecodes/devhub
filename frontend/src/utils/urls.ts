const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Client-side mirror of the backend `validate_public_https_url`: https, a public domain
 * name (no IPs, localhost or internal names) and no embedded credentials.
 * Returns an error message, or null when valid. The backend remains authoritative.
 */
export function publicUrlError(value: string): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Debe ser una URL https:// válida.";
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !host) return "Debe ser una URL https:// válida.";
  if (url.username || url.password) return "La URL no puede incluir credenciales.";
  if (IPV4.test(host) || host.startsWith("[")) return "Usa un nombre de dominio, no una dirección IP.";
  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return "El dominio debe ser público (no localhost ni nombres internos).";
  }
  return null;
}

export function displayUrl(value: string): string {
  return value.replace(/^https:\/\//, "").replace(/\/$/, "");
}
