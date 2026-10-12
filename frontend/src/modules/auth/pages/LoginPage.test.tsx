import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/http";
import { makeUser, renderRoutes } from "@/test/utils";

import { authApi } from "../api";
import { LoginPage } from "./LoginPage";

vi.mock("../api", () => ({ authApi: { me: vi.fn(), login: vi.fn() } }));
const api = vi.mocked(authApi);

function setup(variant: "admin" | "portal" = "admin") {
  return renderRoutes(
    [
      { path: "/login", element: <LoginPage variant={variant} /> },
      { path: "/admin", element: <p>Panel admin</p> },
      { path: "/portal", element: <p>Portal cliente</p> },
    ],
    "/login",
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    api.me.mockReset();
    api.me.mockResolvedValue(null);
    api.login.mockReset();
  });

  it("validates fields before calling the API", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByText("Ingresa un correo electrónico válido.")).toBeInTheDocument();
    expect(screen.getByText("Ingresa tu contraseña.")).toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("shows the server error on invalid credentials", async () => {
    api.login.mockRejectedValue(
      new ApiError(400, { code: "invalid_credentials", detail: "Correo o contraseña incorrectos." }),
    );
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos.");
  });

  it("sends a client to the portal after login", async () => {
    api.login.mockResolvedValue(makeUser({ role: "CLIENT" }));
    const user = userEvent.setup();
    setup("portal");
    await user.type(await screen.findByLabelText("Correo electrónico"), "cliente@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "Clave-Segura-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByText("Portal cliente")).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith(
      { email: "cliente@example.com", password: "Clave-Segura-1" },
      expect.anything(),
    );
  });

  it("redirects an already authenticated admin", async () => {
    api.me.mockResolvedValue(makeUser({ role: "ADMIN" }));
    setup();
    expect(await screen.findByText("Panel admin")).toBeInTheDocument();
  });
});
