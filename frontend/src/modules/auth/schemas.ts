import { z } from "zod";

const email = z.email("Ingresa un correo electrónico válido.");

/** Mirrors the backend password policy (Django validators) for early feedback. */
export const newPassword = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres.")
  .refine((value) => !/^\d+$/.test(value), "La contraseña no puede ser solo numérica.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Ingresa tu contraseña."),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    new_password: newPassword,
    confirm_password: z.string().min(1, "Confirma la contraseña."),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: "Las contraseñas no coinciden.",
    path: ["confirm_password"],
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Ingresa tu contraseña actual."),
    new_password: newPassword,
    confirm_password: z.string().min(1, "Confirma la contraseña."),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: "Las contraseñas no coinciden.",
    path: ["confirm_password"],
  })
  .refine((v) => v.new_password !== v.current_password, {
    message: "La nueva contraseña debe ser distinta a la actual.",
    path: ["new_password"],
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const profileSchema = z.object({
  first_name: z.string().trim().max(150, "Máximo 150 caracteres."),
  last_name: z.string().trim().max(150, "Máximo 150 caracteres."),
});
export type ProfileValues = z.infer<typeof profileSchema>;
