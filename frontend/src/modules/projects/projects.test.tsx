import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/http";
import { makeUser, renderRoutes } from "@/test/utils";
import { usersApi } from "@/modules/users/api";
import type { Paginated } from "@/types/api";

import { projectsApi, type Project, type ProjectMember } from "./api";
import { TechnologyInput } from "./components/TechnologyInput";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  const fn = () => vi.fn();
  return {
    ...original,
    projectsApi: {
      list: fn(), get: fn(), create: fn(), update: fn(), archive: fn(), restore: fn(),
      setVisibility: fn(), uploadLogo: fn(), removeLogo: fn(), technologies: fn(),
      listMembers: fn(), addMember: fn(), updateMember: fn(), removeMember: fn(),
      listAccess: fn(), grantAccess: fn(), revokeAccess: fn(),
    },
  };
});
vi.mock("@/modules/users/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/users/api")>();
  return { ...original, usersApi: { ...original.usersApi, list: vi.fn() } };
});

const api = vi.mocked(projectsApi);
const users = vi.mocked(usersApi);

function page<T>(results: T[]): Paginated<T> {
  return { count: results.length, next: null, previous: null, results };
}

const admin = makeUser({ id: "admin-1", role: "ADMIN" });
const developer = makeUser({ id: "dev-1", role: "DEVELOPER", role_label: "Desarrollador", email: "dev@example.com" });

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    name: "Portal Ventas",
    slug: "portal-ventas",
    description: "Aplicación de ventas",
    client_description: "",
    logo_url: null,
    repository_url: "https://github.com/acme/ventas",
    documentation_url: "",
    site_url: "https://ventas.example.com",
    technologies: ["React", "Django"],
    owner: { id: "admin-1", email: "ana@example.com", full_name: "Ana López", role: "ADMIN", is_active: true },
    status: "DEVELOPMENT",
    status_label: "Desarrollo",
    visibility: "INTERNAL",
    visibility_label: "Interno",
    is_archived: false,
    archived_at: null,
    member_count: 1,
    organization_count: 2,
    permissions: { can_edit: true, can_manage: true },
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.technologies.mockResolvedValue(["Django", "React"]);
  api.listMembers.mockResolvedValue(page<ProjectMember>([]));
  api.listAccess.mockResolvedValue(page([]));
  users.list.mockResolvedValue(page([]));
});

function renderList(user = admin) {
  return renderRoutes(
    [
      { path: "/admin/projects", element: <ProjectsPage /> },
      { path: "/admin/projects/:id", element: <p>Detalle abierto</p> },
    ],
    "/admin/projects",
    { user },
  );
}

describe("ProjectsPage", () => {
  it("renders project cards from the API, active projects by default", async () => {
    api.list.mockResolvedValue(page([makeProject()]));
    renderList();
    expect(await screen.findByText("Portal Ventas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Portal Ventas/ })).toHaveTextContent("Desarrollo");
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ archived: false, page: 1 }));
  });

  it("filters by technology and switches to the table view", async () => {
    api.list.mockResolvedValue(page([makeProject()]));
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Portal Ventas");
    await user.selectOptions(screen.getByLabelText("Filtrar por tecnología"), "React");
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ technology: "React" })),
    );
    await user.click(screen.getByRole("radio", { name: "Tabla" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows the admin empty state with a create action", async () => {
    api.list.mockResolvedValue(page([]));
    renderList();
    expect(await screen.findByText("Aún no hay proyectos")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Nuevo proyecto" }).length).toBeGreaterThan(0);
  });

  it("hides creation from developers", async () => {
    api.list.mockResolvedValue(page([]));
    renderList(developer);
    expect(await screen.findByText(/te asigne a un proyecto/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo proyecto" })).not.toBeInTheDocument();
  });

  it("shows an error state", async () => {
    api.list.mockRejectedValue(new ApiError(500, { code: "server_error", detail: "Error interno del servidor." }));
    renderList();
    expect(await screen.findByText("Error interno del servidor.")).toBeInTheDocument();
  });

  it("validates the create form and sends a normalized payload", async () => {
    api.list.mockResolvedValue(page([]));
    users.list.mockResolvedValue(
      page([{ ...admin, role_label: "Administrador" }] as unknown as Parameters<typeof users.list.mockResolvedValue>[0]["results"]),
    );
    api.create.mockResolvedValue(makeProject({ id: "new-1" }));
    const user = userEvent.setup();
    const { router } = renderList();

    await user.click((await screen.findAllByRole("button", { name: "Nuevo proyecto" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Nuevo proyecto" });
    await user.type(within(dialog).getByLabelText(/Nombre/), "Portal Ventas");
    await user.type(within(dialog).getByLabelText("Repositorio Git"), "http://inseguro.com");
    await user.click(within(dialog).getByRole("button", { name: "Crear proyecto" }));
    expect(await within(dialog).findByText("Debe ser una URL https:// válida.")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText("Repositorio Git"));
    await user.type(within(dialog).getByLabelText("Repositorio Git"), "https://github.com/acme/ventas");
    await user.type(within(dialog).getByLabelText("URL del sitio"), "http://ventas.acme.com");
    await user.click(within(dialog).getByRole("button", { name: "Crear proyecto" }));
    expect(await within(dialog).findAllByText("Debe ser una URL https:// válida.")).toHaveLength(1);
    await user.clear(within(dialog).getByLabelText("URL del sitio"));
    await user.type(within(dialog).getByLabelText("URL del sitio"), "https://ventas.acme.com");
    await user.type(within(dialog).getByLabelText(/Tecnologías/), "React{Enter}Django,");
    await user.click(within(dialog).getByRole("button", { name: "Crear proyecto" }));

    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toEqual({
      name: "Portal Ventas",
      owner: "admin-1",
      status: "PLANNING",
      description: "",
      client_description: "",
      repository_url: "https://github.com/acme/ventas",
      documentation_url: "",
      site_url: "https://ventas.acme.com",
      technologies: ["React", "Django"],
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/projects/new-1"));
  });
});

describe("ProjectDetailPage", () => {
  function renderDetail(project: Project, user = admin) {
    api.get.mockResolvedValue(project);
    return renderRoutes([{ path: "/admin/projects/:id", element: <ProjectDetailPage /> }], `/admin/projects/${project.id}`, { user });
  }

  it("shows management actions and organization access to admins", async () => {
    renderDetail(makeProject());
    expect(await screen.findByRole("heading", { name: /Portal Ventas/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visitar sitio" })).toHaveAttribute("href", "https://ventas.example.com");
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archivar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar en portafolio" })).toBeInTheDocument();
    expect(await screen.findByText("Organizaciones con acceso")).toBeInTheDocument();
  });

  it("is read-only for a contributor developer", async () => {
    renderDetail(makeProject({ permissions: { can_edit: false, can_manage: false } }), developer);
    expect(await screen.findByRole("heading", { name: /Portal Ventas/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archivar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Organizaciones con acceso")).not.toBeInTheDocument();
    expect(screen.queryByText("Logotipo")).not.toBeInTheDocument();
    expect(api.listAccess).not.toHaveBeenCalled();
  });

  it("archives only after confirmation", async () => {
    api.archive.mockResolvedValue(makeProject({ status: "ARCHIVED", is_archived: true }));
    const user = userEvent.setup();
    renderDetail(makeProject());
    await user.click(await screen.findByRole("button", { name: "Archivar" }));
    expect(api.archive).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Archivar proyecto" });
    await user.click(within(dialog).getByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(api.archive).toHaveBeenCalledWith("p-1"));
  });

  it("shows the archived banner", async () => {
    renderDetail(
      makeProject({ status: "ARCHIVED", status_label: "Archivado", is_archived: true, archived_at: "2026-10-11T10:00:00Z", permissions: { can_edit: false, can_manage: true } }),
    );
    expect(await screen.findByText(/Proyecto archivado el/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
  });

  it("shows not found for inaccessible projects", async () => {
    api.get.mockRejectedValue(new ApiError(404, { code: "not_found", detail: "No encontrado." }));
    renderRoutes([{ path: "/admin/projects/:id", element: <ProjectDetailPage /> }], "/admin/projects/x", { user: developer });
    expect(await screen.findByText("Proyecto no encontrado")).toBeInTheDocument();
  });
});

describe("TechnologyInput", () => {
  function Harness({ initial = [] as string[] }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <TechnologyInput id="t" value={value} onChange={setValue} />
        <output data-testid="value">{value.join("|")}</output>
      </>
    );
  }

  it("adds, dedupes, rejects invalid and removes chips", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "React{Enter} react{Enter}Node.js,");
    expect(screen.getByTestId("value")).toHaveTextContent("React|Node.js");
    await user.type(input, "<script>{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Usa letras");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Quitar React" }));
    expect(screen.getByTestId("value")).toHaveTextContent("Node.js");
    await user.type(input, "{Backspace}");
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });
});
