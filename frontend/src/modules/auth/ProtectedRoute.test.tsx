import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/http";
import { makeUser, renderRoutes } from "@/test/utils";

import { authApi } from "./api";
import { ProtectedRoute } from "./ProtectedRoute";

vi.mock("./api", () => ({ authApi: { me: vi.fn() } }));
const me = vi.mocked(authApi.me);

const routes = [
  { path: "/login", element: <p>Pantalla de login</p> },
  { path: "/portal", element: <p>Inicio del portal</p> },
  {
    path: "/admin",
    element: (
      <ProtectedRoute roles={["ADMIN", "DEVELOPER"]} loginPath="/login">
        <p>Panel privado</p>
      </ProtectedRoute>
    ),
  },
];

describe("ProtectedRoute", () => {
  beforeEach(() => {
    me.mockReset();
  });

  it("redirects anonymous users to the login page", async () => {
    me.mockResolvedValue(null);
    const { router } = renderRoutes(routes, "/admin");
    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument();
    expect(router.state.location.state).toEqual({ from: "/admin" });
  });

  it("renders the content for an allowed role", async () => {
    me.mockResolvedValue(makeUser({ role: "DEVELOPER" }));
    renderRoutes(routes, "/admin");
    expect(await screen.findByText("Panel privado")).toBeInTheDocument();
  });

  it("sends a client to the portal instead of the admin panel", async () => {
    me.mockResolvedValue(makeUser({ role: "CLIENT" }));
    renderRoutes(routes, "/admin");
    expect(await screen.findByText("Inicio del portal")).toBeInTheDocument();
    expect(screen.queryByText("Panel privado")).not.toBeInTheDocument();
  });

  it("shows a loading state while the session is resolved", () => {
    me.mockReturnValue(new Promise(() => undefined));
    renderRoutes(routes, "/admin");
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
  });

  it("shows an error with retry when the API is unreachable", async () => {
    me.mockRejectedValue(new ApiError(0, { code: "network_error", detail: "No se pudo conectar con el servidor." }));
    renderRoutes(routes, "/admin");
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
