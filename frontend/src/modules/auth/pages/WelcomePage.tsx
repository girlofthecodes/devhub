import {
  Activity,
  AppWindow,
  ArrowRight,
  BriefcaseBusiness,
  CirclePlay,
  GitBranch,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

import { useCurrentUser } from "../hooks";
import { ADMIN_LOGIN, CLIENT_LOGIN, type Portal } from "../types";

interface PortalOption {
  portal: Portal;
  area: "admin" | "portal";
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  features: { icon: LucideIcon; text: string }[];
  cta: string;
  to: string;
}

const options: PortalOption[] = [
  {
    portal: "admin",
    area: "admin",
    icon: BriefcaseBusiness,
    eyebrow: "Equipo interno",
    title: "Portal administrativo",
    description: "Para administradores y desarrolladores que gestionan las aplicaciones y la operación.",
    features: [
      { icon: GitBranch, text: "Proyectos, despliegues y trazabilidad" },
      { icon: Activity, text: "Infraestructura y monitoreo" },
      { icon: ShieldCheck, text: "Usuarios, accesos y auditoría" },
    ],
    cta: "Acceso administrativo",
    to: ADMIN_LOGIN,
  },
  {
    portal: "client",
    area: "portal",
    icon: AppWindow,
    eyebrow: "Clientes",
    title: "Portal del cliente",
    description: "Para las organizaciones que usan nuestras aplicaciones y quieren consultarlas.",
    features: [
      { icon: AppWindow, text: "Tus aplicaciones contratadas" },
      { icon: CirclePlay, text: "Demostraciones autorizadas" },
      { icon: Activity, text: "Disponibilidad y versiones publicadas" },
    ],
    cta: "Acceso de clientes",
    to: CLIENT_LOGIN,
  },
];

function PortalCard({ option, activeSession }: { option: PortalOption; activeSession: boolean }) {
  const Icon = option.icon;
  return (
    <div data-area={option.area} className="h-full">
      <Link
        to={option.to}
        className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-8"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent opacity-[0.07] blur-2xl transition-opacity group-hover:opacity-[0.14]"
        />
        <div className="relative flex items-start justify-between gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon className="size-6" aria-hidden />
          </span>
          {activeSession && (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
              Sesión activa
            </span>
          )}
        </div>
        <p className="relative mt-6 text-xs font-semibold uppercase tracking-wider text-accent">{option.eyebrow}</p>
        <h2 className="relative mt-1 text-xl font-semibold tracking-tight text-fg">{option.title}</h2>
        <p className="relative mt-2 text-sm text-muted">{option.description}</p>
        <ul className="relative mt-6 space-y-3">
          {option.features.map(({ icon: FeatureIcon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-sm text-fg">
              <FeatureIcon className="size-4 shrink-0 text-accent" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <span className="relative mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-colors group-hover:bg-accent-hover">
          {option.cta}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>
    </div>
  );
}

/** Entry screen: lets the visitor choose which portal to sign in to. */
export function WelcomePage() {
  const { data: user } = useCurrentUser();
  return (
    <div data-area="admin" className="relative flex min-h-dvh flex-col overflow-hidden bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-accent opacity-[0.06] blur-3xl"
      />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo subtitle="Centro de operaciones" />
        <ThemeToggle />
      </header>
      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 pb-12 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Bienvenido a DevHub</h1>
          <p className="mt-3 text-base text-muted">
            La plataforma donde administramos nuestras aplicaciones, su infraestructura y la relación con cada
            cliente. Elige el portal al que quieres ingresar.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {options.map((option) => (
            <PortalCard key={option.portal} option={option} activeSession={user?.portal === option.portal} />
          ))}
        </div>
      </main>
      <footer className="relative py-6 text-center text-xs text-muted">© {new Date().getFullYear()} DevHub</footer>
    </div>
  );
}
