import { createBrowserRouter, Navigate, type RouteObject } from "react-router";

import { FullPageSpinner } from "@/components/ui/Feedback";
import { AdminLayout } from "@/layouts/AdminLayout";
import { PortalLayout } from "@/layouts/PortalLayout";
import { AuditPage } from "@/modules/audit/AuditPage";
import { useCurrentUser } from "@/modules/auth/hooks";
import { ForgotPasswordPage } from "@/modules/auth/pages/ForgotPasswordPage";
import { LoginPage } from "@/modules/auth/pages/LoginPage";
import { ProfilePage } from "@/modules/auth/pages/ProfilePage";
import { ResetPasswordPage } from "@/modules/auth/pages/ResetPasswordPage";
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute";
import { homePathFor, PORTAL_ROLES, STAFF_ROLES } from "@/modules/auth/types";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";
import { OrganizationDetailPage } from "@/modules/organizations/pages/OrganizationDetailPage";
import { OrganizationsPage } from "@/modules/organizations/pages/OrganizationsPage";
import { PortalHomePage } from "@/modules/portal/PortalHomePage";
import { UsersPage } from "@/modules/users/pages/UsersPage";

import { NotFoundPage } from "./NotFoundPage";

function RootRedirect() {
  const { data: user, isPending } = useCurrentUser();
  if (isPending) return <FullPageSpinner />;
  return <Navigate to={homePathFor(user?.role)} replace />;
}

const adminOnly = (element: React.ReactNode) => (
  <ProtectedRoute roles={["ADMIN"]} loginPath="/login">
    {element}
  </ProtectedRoute>
);

export const routes: RouteObject[] = [
  { path: "/", element: <RootRedirect /> },
  { path: "/login", element: <LoginPage variant="admin" /> },
  { path: "/portal/login", element: <LoginPage variant="portal" /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    path: "/admin",
    element: (
      <ProtectedRoute roles={STAFF_ROLES} loginPath="/login">
        <AdminLayout />
      </ProtectedRoute>
    ),
    handle: { crumb: "Inicio" },
    children: [
      { index: true, element: <DashboardPage />, handle: { crumb: "Dashboard" } },
      {
        path: "organizations",
        handle: { crumb: "Organizaciones" },
        children: [
          { index: true, element: <OrganizationsPage /> },
          { path: ":id", element: <OrganizationDetailPage />, handle: { crumb: "Detalle" } },
        ],
      },
      { path: "users", element: adminOnly(<UsersPage />), handle: { crumb: "Usuarios" } },
      { path: "audit", element: adminOnly(<AuditPage />), handle: { crumb: "Auditoría" } },
      { path: "profile", element: <ProfilePage />, handle: { crumb: "Mi perfil" } },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "/portal",
    element: (
      <ProtectedRoute roles={PORTAL_ROLES} loginPath="/portal/login">
        <PortalLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <PortalHomePage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

export const createRouter = () => createBrowserRouter(routes);
