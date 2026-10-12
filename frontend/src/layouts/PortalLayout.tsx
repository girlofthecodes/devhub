import { AppWindow, CirclePlay, House, User, type LucideIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AreaContext } from "@/components/ui/area";
import { UserMenu } from "@/components/UserMenu";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { cn } from "@/utils/cn";

interface PortalNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  availableInPhase?: number;
  /** Hidden for visitors (they only see the public portfolio). */
  clientOnly?: boolean;
}

const items: PortalNavItem[] = [
  { label: "Inicio", to: "/portal", icon: House },
  { label: "Mis aplicaciones", to: "/portal/apps", icon: AppWindow, clientOnly: true },
  { label: "Demostraciones", to: "/portal/demos", icon: CirclePlay, clientOnly: true },
  { label: "Mi perfil", to: "/portal/profile", icon: User },
];

function PortalNavLink({ item }: { item: PortalNavItem }) {
  const Icon = item.icon;
  const base = "flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors";
  if (item.availableInPhase) {
    return (
      <span
        aria-disabled="true"
        title="Disponible próximamente"
        className={cn(base, "cursor-not-allowed text-muted/50")}
      >
        <Icon className="size-4" aria-hidden />
        {item.label}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      end={item.to === "/portal"}
      className={({ isActive }) =>
        cn(base, isActive ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg")
      }
    >
      <Icon className="size-4" aria-hidden />
      {item.label}
    </NavLink>
  );
}

export function PortalLayout() {
  const user = useAuthenticatedUser();
  const visible = items.filter((i) => !i.clientOnly || user.role === "CLIENT");
  return (
    <AreaContext.Provider value="portal">
      <div data-area="portal" className="min-h-dvh bg-bg">
        <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
            <Logo subtitle="Portal de clientes" />
            <nav aria-label="Navegación del portal" className="hidden flex-1 justify-center gap-1 md:flex">
              {visible.map((item) => (
                <PortalNavLink key={item.to} item={item} />
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <ThemeToggle className="hidden sm:inline-flex" />
              <UserMenu profilePath="/portal/profile" loginPath="/portal/login" />
            </div>
          </div>
          <nav
            aria-label="Navegación del portal (móvil)"
            className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden"
          >
            {visible.map((item) => (
              <PortalNavLink key={item.to} item={item} />
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </AreaContext.Provider>
  );
}
