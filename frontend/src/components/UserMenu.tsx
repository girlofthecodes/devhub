import { LogOut, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser, useLogout } from "@/modules/auth/hooks";
import { cn } from "@/utils/cn";

export function UserMenu({ profilePath, loginPath }: { profilePath: string; loginPath: string }) {
  // The session may become null while logging out (before navigating away).
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleLogout() {
    logout.mutate(undefined, {
      onSettled: () => navigate(loginPath, { replace: true }),
      onError: () => toast.error("La sesión se cerró localmente", "No se pudo contactar al servidor."),
    });
  }

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 text-left hover:bg-surface-2"
      >
        <Avatar name={user.full_name} />
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-40 truncate text-sm font-medium text-fg">{user.full_name}</span>
          <span className="block text-xs text-muted">{user.role_label}</span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-40 mt-2 w-60 animate-slide-up overflow-hidden rounded-xl border border-border bg-surface shadow-lg",
          )}
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium text-fg">{user.full_name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="p-1">
            <Link
              role="menuitem"
              to={profilePath}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-fg hover:bg-surface-2"
            >
              <User className="size-4 text-muted" /> Mi perfil
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={handleLogout}
              disabled={logout.isPending}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <LogOut className="size-4" /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
