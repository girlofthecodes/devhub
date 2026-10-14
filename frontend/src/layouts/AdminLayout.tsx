import { ChevronsLeft, ChevronsRight, Menu, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AreaContext } from "@/components/ui/area";
import { UserMenu } from "@/components/UserMenu";
import { useAuthenticatedUser } from "@/modules/auth/hooks";
import { cn } from "@/utils/cn";

import { Breadcrumbs } from "./Breadcrumbs";
import { adminNavigation, type NavItem } from "./navigation";

const COLLAPSE_KEY = "devhub-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function SidebarLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const base =
    "group flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors";
  if (item.availableInPhase) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label}: disponible en la Fase ${item.availableInPhase}`}
        className={cn(base, "cursor-not-allowed text-muted/50")}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <span className="rounded border border-border px-1 text-[10px] font-normal">
              F{item.availableInPhase}
            </span>
          </>
        )}
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      end={item.end || item.to === "/admin"}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          base,
          isActive
            ? "bg-accent-soft text-accent"
            : "text-muted hover:bg-surface-2 hover:text-fg",
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const user = useAuthenticatedUser();
  return (
    <nav aria-label="Navegación principal" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {adminNavigation.map((group) => {
        const items = group.items.filter(
          (i) => user.role && i.roles.includes(user.role) && (!i.requiresFinance || user.finance_access !== "NONE"),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.section}>
            {!collapsed && (
              <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted/70">
                {group.section}
              </p>
            )}
            <div className="space-y-0.5">
              {items.map((item) => (
                <SidebarLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !value;
    });
  }

  return (
    <AreaContext.Provider value="admin">
      <div data-area="admin" className="flex min-h-dvh bg-bg">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex",
            collapsed ? "w-[68px]" : "w-60",
          )}
        >
          <div className="flex h-14 items-center border-b border-border px-4">
            <Logo subtitle="Admin" collapsed={collapsed} />
          </div>
          <SidebarNav collapsed={collapsed} />
          <div className="border-t border-border p-3">
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
              aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"}
            >
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
              {!collapsed && "Contraer"}
            </button>
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden />
            <aside className="relative flex h-full w-64 animate-slide-up flex-col border-r border-border bg-surface">
              <div className="flex h-14 items-center justify-between border-b border-border px-4">
                <Logo subtitle="Admin" />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Cerrar menú"
                  className="text-muted hover:text-fg"
                >
                  <X className="size-5" />
                </button>
              </div>
              <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur sm:px-6">
            <button
              type="button"
              className="text-muted hover:text-fg lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <Breadcrumbs />
            </div>
            <ThemeToggle className="hidden sm:inline-flex" />
            <UserMenu profilePath="/admin/profile" loginPath="/admin/login" />
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </AreaContext.Provider>
  );
}
