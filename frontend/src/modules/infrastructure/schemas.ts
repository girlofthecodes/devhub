import { z } from "zod";

import { publicUrlError } from "@/utils/urls";

const status = z.enum(["ACTIVE", "MAINTENANCE", "INACTIVE"]);

function isPrivateAddress(value: string): boolean {
  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (v4.slice(1).some((p) => Number(p) > 255)) return false;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  // IPv6 unique-local (fc00::/7), e.g. Tailscale fd7a:…
  return /^f[cd][0-9a-f]{2}:/i.test(value);
}

export const serverSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres.").max(100, "Máximo 100 caracteres."),
  identifier: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "Usa minúsculas, números y guiones (p. ej. homelab-app-01)."),
  location: z.string().trim().max(100, "Máximo 100 caracteres."),
  server_type: z.enum(["APPLICATION", "DATABASE", "MIXED", "OTHER"]),
  operating_system: z.string().trim().max(80, "Máximo 80 caracteres."),
  vpn_address: z
    .string()
    .trim()
    .refine((v) => v === "" || isPrivateAddress(v), "Debe ser una dirección privada de la VPN o LAN, nunca pública."),
  status,
  notes: z.string().trim().max(2000, "Máximo 2000 caracteres."),
});
export type ServerValues = z.infer<typeof serverSchema>;

export const environmentSchema = z.object({
  project: z.string().min(1, "Selecciona un proyecto."),
  kind: z.enum(["DEVELOPMENT", "DEMO", "PRODUCTION"], { error: "Selecciona un tipo." }),
  name: z.string().trim().max(60, "Máximo 60 caracteres."),
  server: z.string(),
  public_url: z
    .string()
    .trim()
    .max(300, "Máximo 300 caracteres.")
    .superRefine((v, ctx) => {
      const error = publicUrlError(v);
      if (error) ctx.addIssue({ code: "custom", message: error });
    }),
  deployed_version: z
    .string()
    .trim()
    .regex(/^[\w.+-]{0,50}$/, "Usa letras, números y . _ - + (p. ej. v1.4.0)."),
  status,
});
export type EnvironmentValues = z.infer<typeof environmentSchema>;
