import { z } from "zod";

export const organizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres.")
    .max(150, "Máximo 150 caracteres."),
  description: z.string().trim().max(2000, "Máximo 2000 caracteres."),
  contact_email: z.union([z.literal(""), z.email("Ingresa un correo válido.")]),
});
export type OrganizationValues = z.infer<typeof organizationSchema>;

export const addMemberSchema = z.object({
  user: z.string().min(1, "Selecciona un usuario."),
  role: z.enum(["OWNER", "MEMBER"]),
});
export type AddMemberValues = z.infer<typeof addMemberSchema>;
