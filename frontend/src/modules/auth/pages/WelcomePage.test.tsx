import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeUser, renderRoutes } from "@/test/utils";

import { authApi } from "../api";
import { WelcomePage } from "./WelcomePage";

vi.mock("../api", () => ({ authApi: { me: vi.fn() } }));
const me = vi.mocked(authApi.me);

function setup() {
  return renderRoutes(
    [
      { path: "/", element: <WelcomePage /> },
      { path: "/admin/login", element: <p>Login administrativo</p> },
      { path: "/cliente/login", element: <p>Login de clientes</p> },
    ],
    "/",
  );
}

describe("WelcomePage", () => {
  beforeEach(() => me.mockReset());

  it("offers both portals", async () => {
    me.mockResolvedValue(null);
    setup();
    expect(screen.getByRole("heading", { name: "Bienvenido a DevHub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acceso administrativo/ })).toHaveAttribute("href", "/admin/login");
    expect(screen.getByRole("link", { name: /Acceso de clientes/ })).toHaveAttribute("href", "/cliente/login");
  });

  it("navigates to the client login", async () => {
    me.mockResolvedValue(null);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("link", { name: /Acceso de clientes/ }));
    expect(await screen.findByText("Login de clientes")).toBeInTheDocument();
  });

  it("marks the portal with an open session", async () => {
    me.mockResolvedValue(makeUser({ role: "CLIENT" }));
    setup();
    const client = screen.getByRole("link", { name: /Acceso de clientes/ });
    expect(await screen.findByText("Sesión activa")).toBeInTheDocument();
    expect(client).toHaveTextContent("Sesión activa");
  });
});
