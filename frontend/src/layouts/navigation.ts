import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  FileSignature,
  HandCoins,
  PieChart,
  Receipt,
  Building2,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  Layers,
  Rocket,
  ScrollText,
  Server,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/types/api";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: readonly Role[];
  /** Roadmap phase in which the module ships; shown disabled until then. */
  availableInPhase?: number;
  /** Shown only with explicit finance access (UX only; the API enforces it). */
  requiresFinance?: boolean;
  /** Active only on this exact path (not on nested routes). */
  end?: boolean;
}

const STAFF: readonly Role[] = ["ADMIN", "DEVELOPER"];
const ADMIN: readonly Role[] = ["ADMIN"];

export const adminNavigation: { section: string; items: NavItem[] }[] = [
  {
    section: "General",
    items: [
      { label: "Dashboard", to: "/admin", icon: LayoutDashboard, roles: STAFF },
      { label: "Proyectos", to: "/admin/projects", icon: FolderKanban, roles: STAFF },
      { label: "Organizaciones", to: "/admin/organizations", icon: Building2, roles: STAFF },
      { label: "Usuarios", to: "/admin/users", icon: Users, roles: ADMIN },
    ],
  },
  {
    section: "Operación",
    items: [
      { label: "Infraestructura", to: "/admin/infrastructure", icon: Server, roles: STAFF },
      { label: "Entornos", to: "/admin/environments", icon: Layers, roles: STAFF },
      { label: "Despliegues", to: "/admin/deployments", icon: Rocket, roles: STAFF },
      { label: "Trazabilidad", to: "/admin/traceability", icon: GitBranch, roles: STAFF },
      { label: "Monitoreo", to: "/admin/monitoring", icon: Activity, roles: STAFF },
    ],
  },
  {
    section: "Negocio y Rentabilidad",
    items: [
      { label: "Resumen", to: "/admin/business", icon: PieChart, roles: STAFF, requiresFinance: true, end: true },
      { label: "Aplicaciones comerciales", to: "/admin/business/applications", icon: BriefcaseBusiness, roles: STAFF, requiresFinance: true },
      { label: "Contratos", to: "/admin/business/contracts", icon: FileSignature, roles: STAFF, requiresFinance: true },
      { label: "Cobros", to: "/admin/business/receivables", icon: HandCoins, roles: STAFF, requiresFinance: true },
      { label: "Gastos", to: "/admin/business/expenses", icon: Receipt, roles: STAFF, requiresFinance: true },
      { label: "Reportes", to: "/admin/business/reports", icon: BarChart3, roles: STAFF, requiresFinance: true },
    ],
  },
  {
    section: "Sistema",
    items: [
      { label: "Auditoría", to: "/admin/audit", icon: ScrollText, roles: ADMIN },
      { label: "Integraciones", to: "/admin/settings/integrations", icon: Settings, roles: ADMIN },
    ],
  },
];
