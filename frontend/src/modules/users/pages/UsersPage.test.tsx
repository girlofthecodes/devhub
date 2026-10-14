import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/http";
import { makeUser, renderPage } from "@/test/utils";

import { usersApi, type User } from "../api";
import { UsersPage } from "./UsersPage";

vi.mock("../api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api")>();
  return {
    ...original,
    usersApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), activate: vi.fn(), deactivate: vi.fn(), revokeSessions: vi.fn() },
  };
});
const api = vi.mocked(usersApi);

const sample: User = {
  id: "u-2",
  email: "dev@example.com",
  first_name: "Dev",
  last_name: "Uno",
  full_name: "Dev Uno",
  role: "DEVELOPER",
  role_label: "Desarrollador",
  client_portal_access: false,
  finance_access: "NONE",
  is_active: true,
  date_joined: "2026-01-01T00:00:00Z",
  last_login: null,
};

function setup() {
  return renderPage(<UsersPage />, "/", { user: makeUser() });
}

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders users returned by the API", async () => {
    api.list.mockResolvedValue({ count: 1, next: null, previous: null, results: [sample] });
    setup();
    expect(await screen.findByText("dev@example.com")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Desarrollador")).toBeInTheDocument();
    expect(screen.getByText("1–1 de 1")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    api.list.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    setup();
    expect(await screen.findByText("Aún no hay usuarios")).toBeInTheDocument();
  });

  it("shows an error state and retries", async () => {
    api.list.mockRejectedValueOnce(new ApiError(500, { code: "server_error", detail: "Error interno del servidor." }));
    api.list.mockResolvedValueOnce({ count: 1, next: null, previous: null, results: [sample] });
    const user = userEvent.setup();
    setup();
    expect(await screen.findByText("Error interno del servidor.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("dev@example.com")).toBeInTheDocument();
  });

  it("creates a user and maps backend field errors", async () => {
    api.list.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    api.create.mockRejectedValueOnce(
      new ApiError(400, {
        code: "validation_error",
        detail: "Los datos enviados no son válidos.",
        fields: { email: ["Ya existe un usuario con este correo."] },
      }),
    );
    api.create.mockResolvedValueOnce({ ...sample, email: "nuevo@example.com" });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    const dialog = await screen.findByRole("dialog", { name: "Nuevo usuario" });
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(await screen.findByText("Ingresa un correo electrónico válido.")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Correo electrónico/), "nuevo@example.com");
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(await screen.findByText("Ya existe un usuario con este correo.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(api.create).toHaveBeenLastCalledWith({
      email: "nuevo@example.com",
      first_name: "",
      last_name: "",
      role: "CLIENT",
      client_portal_access: false,
      finance_access: "NONE",
    });
    expect(await screen.findByText("Usuario creado")).toBeInTheDocument();
  });

  it("offers explicit finance access and extra client access only to developers", async () => {
    api.list.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    api.create.mockResolvedValue({ ...sample, email: "dev2@example.com" });
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await screen.findByRole("dialog", { name: "Nuevo usuario" });
    expect(screen.queryByLabelText("Acceso financiero")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Correo electrónico/), "dev2@example.com");
    await user.selectOptions(screen.getByLabelText(/^Rol/), "DEVELOPER");
    await user.selectOptions(screen.getByLabelText("Acceso financiero"), "VIEW");
    await user.click(screen.getByLabelText(/También puede entrar al portal de clientes/));
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() =>
      expect(api.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: "DEVELOPER", finance_access: "VIEW", client_portal_access: true }),
      ),
    );
  });

  it("asks for confirmation before deactivating", async () => {
    api.list.mockResolvedValue({ count: 1, next: null, previous: null, results: [sample] });
    api.deactivate.mockResolvedValue({ ...sample, is_active: false });
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Desactivar dev@example.com" }));
    expect(api.deactivate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(api.deactivate).toHaveBeenCalledWith("u-2"));
  });
});
