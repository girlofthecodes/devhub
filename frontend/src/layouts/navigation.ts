import {
  Activity,
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
      { label: "Infraestructura", to: "/admin/infrastructure", icon: Server, roles: STAFF, availableInPhase: 3 },
      { label: "Entornos", to: "/admin/environments", icon: Layers, roles: STAFF, availableInPhase: 3 },
      { label: "Despliegues", to: "/admin/deployments", icon: Rocket, roles: STAFF, availableInPhase: 4 },
      { label: "Trazabilidad", to: "/admin/traceability", icon: GitBranch, roles: STAFF, availableInPhase: 4 },
      { label: "Monitoreo", to: "/admin/monitoring", icon: Activity, roles: STAFF, availableInPhase: 6 },
    ],
  },
  {
    section: "Sistema",
    items: [
      { label: "Auditoría", to: "/admin/audit", icon: ScrollText, roles: ADMIN },
      { label: "Configuración", to: "/admin/settings", icon: Settings, roles: ADMIN, availableInPhase: 6 },
    ],
  },
];
