import { ApiError, ensureCsrf, http } from "@/services/http";

import type { CurrentUser } from "./types";

export const authApi = {
  /** Returns the current user, or null when there is no valid session. */
  async me(): Promise<CurrentUser | null> {
    try {
      const { data } = await http.get<CurrentUser>("/auth/me/");
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) return null;
      throw error;
    }
  },

  async login(payload: { email: string; password: string }): Promise<CurrentUser> {
    await ensureCsrf();
    const { data } = await http.post<CurrentUser>("/auth/login/", payload);
    return data;
  },

  async logout(): Promise<void> {
    await http.post("/auth/logout/");
  },

  async updateProfile(payload: { first_name: string; last_name: string }): Promise<CurrentUser> {
    const { data } = await http.patch<CurrentUser>("/auth/me/", payload);
    return data;
  },

  async changePassword(payload: { current_password: string; new_password: string }) {
    const { data } = await http.post<{ detail: string }>("/auth/change-password/", payload);
    return data;
  },

  async requestPasswordReset(payload: { email: string }) {
    await ensureCsrf();
    const { data } = await http.post<{ detail: string }>("/auth/password-reset/", payload);
    return data;
  },

  async confirmPasswordReset(payload: { uid: string; token: string; new_password: string }) {
    await ensureCsrf();
    const { data } = await http.post<{ detail: string }>("/auth/password-reset/confirm/", payload);
    return data;
  },
};
