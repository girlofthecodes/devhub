import { z } from "zod";

import { publicUrlError } from "@/utils/urls";

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

const httpsUrl = z
  .string()
  .trim()
  .max(300, "Máximo 300 caracteres.")
  .refine((v) => v === "" || isHttpsUrl(v), "Debe ser una URL https:// válida.");

export const TECH_PATTERN = /^[\p{L}\p{N}_ .#+\-/]+$/u;

export const projectSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres.").max(120, "Máximo 120 caracteres."),
  owner: z.string().min(1, "Selecciona un responsable."),
  status: z.enum(["PLANNING", "DEVELOPMENT", "TESTING", "AVAILABLE", "MAINTENANCE"]),
  description: z.string().trim().max(5000, "Máximo 5000 caracteres."),
  client_description: z.string().trim().max(5000, "Máximo 5000 caracteres."),
  repository_url: httpsUrl,
  documentation_url: httpsUrl,
  site_url: z
    .string()
    .trim()
    .max(300, "Máximo 300 caracteres.")
    .superRefine((v, ctx) => {
      const error = publicUrlError(v);
      if (error) ctx.addIssue({ code: "custom", message: error });
    }),
  technologies: z
    .array(z.string().max(40, "Máximo 40 caracteres por tecnología.").regex(TECH_PATTERN))
    .max(20, "Máximo 20 tecnologías."),
});
export type ProjectValues = z.infer<typeof projectSchema>;

export const grantSchema = z.object({
  project: z.string().min(1, "Selecciona un proyecto."),
  organization: z.string().min(1, "Selecciona una organización."),
  expires_on: z
    .string()
    .refine(
      (v) => v === "" || new Date(`${v}T23:59:59`) > new Date(),
      "La fecha debe ser futura.",
    ),
  notes: z.string().trim().max(255, "Máximo 255 caracteres."),
});
export type GrantValues = z.infer<typeof grantSchema>;
