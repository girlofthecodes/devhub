import { Activity, GitBranch, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AreaContext } from "@/components/ui/area";

interface AuthLayoutProps {
  variant: "admin" | "portal";
  title: string;
  subtitle: string;
  children: ReactNode;
}

const highlights = {
  admin: [
    { icon: GitBranch, text: "Trazabilidad de cada versión y despliegue." },
    { icon: Activity, text: "Disponibilidad de tus aplicaciones en un solo lugar." },
    { icon: ShieldCheck, text: "Accesos por rol, auditados de punta a punta." },
  ],
  portal: [
    { icon: ShieldCheck, text: "Acceso privado solo a tus aplicaciones." },
    { icon: Activity, text: "Consulta el estado y las versiones publicadas." },
    { icon: GitBranch, text: "Notas de versión y demostraciones autorizadas." },
  ],
};

export function AuthLayout({ variant, title, subtitle, children }: AuthLayoutProps) {
  return (
    <AreaContext.Provider value={variant}>
      <div data-area={variant} className="grid min-h-dvh bg-bg lg:grid-cols-[1.1fr_1fr]">
        <section className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-32 -top-32 size-[28rem] rounded-full bg-accent opacity-[0.08] blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-40 right-0 size-[32rem] rounded-full bg-accent opacity-[0.06] blur-3xl"
          />
          <Logo subtitle={variant === "admin" ? "Centro de operaciones" : "Portal de clientes"} />
          <div className="relative max-w-md">
            <h2 className="text-3xl font-semibold tracking-tight text-fg">
              {variant === "admin"
                ? "Todas tus aplicaciones, un solo centro de control."
                : "Tus aplicaciones, siempre a la mano."}
            </h2>
            <ul className="mt-8 space-y-4">
              {highlights[variant].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-muted">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon className="size-4" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-muted">© {new Date().getFullYear()} DevHub</p>
        </section>

        <section className="flex flex-col px-6 py-8 sm:px-10">
          <div className="flex items-center justify-between">
            <span className="lg:hidden">
              <Logo subtitle={variant === "admin" ? "Admin" : "Portal de clientes"} />
            </span>
            <ThemeToggle className="ml-auto" />
          </div>
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
            <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
        </section>
      </div>
    </AreaContext.Provider>
  );
}
