import { z } from "zod";

const role = z.enum(["ADMIN", "DEVELOPER", "CLIENT", "VISITOR"], {
  error: "Selecciona un rol.",
});

export const userCreateSchema = z.object({
  email: z.email("Ingresa un correo electrónico válido."),
  first_name: z.string().trim().max(150, "Máximo 150 caracteres."),
  last_name: z.string().trim().max(150, "Máximo 150 caracteres."),
  role,
  password: z
    .string()
    .refine((v) => v === "" || v.length >= 10, "Mínimo 10 caracteres (o déjala vacía)."),
});
export type UserCreateValues = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  first_name: z.string().trim().max(150, "Máximo 150 caracteres."),
  last_name: z.string().trim().max(150, "Máximo 150 caracteres."),
  role,
});
export type UserUpdateValues = z.infer<typeof userUpdateSchema>;
