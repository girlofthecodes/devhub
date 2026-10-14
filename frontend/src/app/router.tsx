import { createBrowserRouter, Navigate, useLocation, type RouteObject } from "react-router";

import { AdminLayout } from "@/layouts/AdminLayout";
import { PortalLayout } from "@/layouts/PortalLayout";
import { AuditPage } from "@/modules/audit/AuditPage";
import { ForgotPasswordPage } from "@/modules/auth/pages/ForgotPasswordPage";
import { LoginPage } from "@/modules/auth/pages/LoginPage";
import { ProfilePage } from "@/modules/auth/pages/ProfilePage";
import { ResetPasswordPage } from "@/modules/auth/pages/ResetPasswordPage";
import { WelcomePage } from "@/modules/auth/pages/WelcomePage";
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute";
import { ADMIN_LOGIN, CLIENT_HOME, CLIENT_LOGIN, PORTAL_ROLES, STAFF_ROLES } from "@/modules/auth/types";
import { ApplicationsPage } from "@/modules/commercial/pages/ApplicationsPage";
import { BusinessOverviewPage } from "@/modules/commercial/pages/BusinessOverviewPage";
import { ContractDetailPage } from "@/modules/commercial/pages/ContractDetailPage";
import { ContractsPage } from "@/modules/commercial/pages/ContractsPage";
import { ExpensesPage } from "@/modules/commercial/pages/ExpensesPage";
import { ReceivablesPage } from "@/modules/commercial/pages/ReceivablesPage";
import { ReportsPage } from "@/modules/commercial/pages/ReportsPage";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";
import { DeploymentDetailPage } from "@/modules/deployments/pages/DeploymentDetailPage";
import { DeploymentsPage } from "@/modules/deployments/pages/DeploymentsPage";
import { EnvironmentsPage } from "@/modules/infrastructure/pages/EnvironmentsPage";
import { InfrastructurePage } from "@/modules/infrastructure/pages/InfrastructurePage";
import { ServerDetailPage } from "@/modules/infrastructure/pages/ServerDetailPage";
import { OrganizationDetailPage } from "@/modules/organizations/pages/OrganizationDetailPage";
import { OrganizationsPage } from "@/modules/organizations/pages/OrganizationsPage";
import {
  DemoLaunchPage,
  PortalAppDetailPage,
  PortalAppsPage,
  PortalContractsPage,
  PortalDemosPage,
} from "@/modules/portal/pages";
import { HealthCheckDetailPage, MonitoringPage } from "@/modules/monitoring/pages";
import { PortalHomePage } from "@/modules/portal/PortalHomePage";
import { ProjectDetailPage } from "@/modules/projects/pages/ProjectDetailPage";
import { ProjectsPage } from "@/modules/projects/pages/ProjectsPage";
import { IntegrationsPage } from "@/modules/settings/IntegrationsPage";
import { TraceabilityPage } from "@/modules/traceability/pages/TraceabilityPage";
import { UsersPage } from "@/modules/users/pages/UsersPage";

import { NotFoundPage } from "./NotFoundPage";

/** Old client-portal URLs (/portal/...) keep working: they move to /cliente/... */
function LegacyPortalRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/portal/, CLIENT_HOME) + search} replace />;
}

const adminOnly = (element: React.ReactNode) => (
  <ProtectedRoute roles={["ADMIN"]} loginPath={ADMIN_LOGIN}>
    {element}
  </ProtectedRoute>
);

const clientOnly = (element: React.ReactNode) => (
  <ProtectedRoute roles={["CLIENT"]} loginPath={CLIENT_LOGIN}>
    {element}
  </ProtectedRoute>
);

export const routes: RouteObject[] = [
  { path: "/", element: <WelcomePage /> },
  { path: ADMIN_LOGIN, element: <LoginPage portal="admin" /> },
  { path: CLIENT_LOGIN, element: <LoginPage portal="client" /> },
  { path: "/login", element: <Navigate to={ADMIN_LOGIN} replace /> },
  { path: "/portal/*", element: <LegacyPortalRedirect /> },
  { path: "/portal", element: <LegacyPortalRedirect /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    path: "/admin",
    element: (
      <ProtectedRoute roles={STAFF_ROLES} loginPath={ADMIN_LOGIN}>
        <AdminLayout />
      </ProtectedRoute>
    ),
    handle: { crumb: "Inicio" },
    children: [
      { index: true, element: <DashboardPage />, handle: { crumb: "Dashboard" } },
      {
        path: "projects",
        handle: { crumb: "Proyectos" },
        children: [
          { index: true, element: <ProjectsPage /> },
          { path: ":id", element: <ProjectDetailPage />, handle: { crumb: "Detalle" } },
        ],
      },
      {
        path: "infrastructure",
        handle: { crumb: "Infraestructura" },
        children: [
          { index: true, element: <InfrastructurePage /> },
          { path: "servers/:id", element: <ServerDetailPage />, handle: { crumb: "Servidor" } },
        ],
      },
      { path: "environments", element: <EnvironmentsPage />, handle: { crumb: "Entornos" } },
      {
        path: "deployments",
        handle: { crumb: "Despliegues" },
        children: [
          { index: true, element: <DeploymentsPage /> },
          { path: ":id", element: <DeploymentDetailPage />, handle: { crumb: "Detalle" } },
        ],
      },
      { path: "traceability", element: <TraceabilityPage />, handle: { crumb: "Trazabilidad" } },
      {
        path: "monitoring",
        handle: { crumb: "Monitoreo" },
        children: [
          { index: true, element: <MonitoringPage /> },
          { path: ":id", element: <HealthCheckDetailPage />, handle: { crumb: "Health check" } },
        ],
      },
      {
        path: "business",
        handle: { crumb: "Negocio y Rentabilidad" },
        children: [
          { index: true, element: <BusinessOverviewPage /> },
          { path: "applications", element: <ApplicationsPage />, handle: { crumb: "Aplicaciones comerciales" } },
          {
            path: "contracts",
            handle: { crumb: "Contratos" },
            children: [
              { index: true, element: <ContractsPage /> },
              { path: ":id", element: <ContractDetailPage />, handle: { crumb: "Detalle" } },
            ],
          },
          { path: "receivables", element: <ReceivablesPage />, handle: { crumb: "Cobros" } },
          { path: "expenses", element: <ExpensesPage />, handle: { crumb: "Gastos" } },
          { path: "reports", element: <ReportsPage />, handle: { crumb: "Reportes" } },
        ],
      },
      {
        path: "settings/integrations",
        element: adminOnly(<IntegrationsPage />),
        handle: { crumb: "Integraciones" },
      },
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
    path: CLIENT_HOME,
    element: (
      <ProtectedRoute roles={PORTAL_ROLES} loginPath={CLIENT_LOGIN}>
        <PortalLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <PortalHomePage /> },
      { path: "apps", element: clientOnly(<PortalAppsPage />) },
      { path: "apps/:id", element: clientOnly(<PortalAppDetailPage />) },
      { path: "apps/:id/demo", element: clientOnly(<DemoLaunchPage />) },
      { path: "demos", element: clientOnly(<PortalDemosPage />) },
      { path: "contracts", element: clientOnly(<PortalContractsPage />) },
      { path: "profile", element: <ProfilePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

export const createRouter = () => createBrowserRouter(routes);
