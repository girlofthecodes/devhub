import {
  Ban,
  CircleCheck,
  CircleX,
  FolderPlus,
  KeyRound,
  Pencil,
  Rocket,
  ShieldOff,
  SlidersHorizontal,
  WifiOff,
  Wifi,
  type LucideIcon,
} from "lucide-react";

import type { BadgeTone } from "@/components/ui/Badge";

import type { EventSource, EventType, Severity } from "./api";

export const EVENT_TYPES: Record<EventType, { label: string; icon: LucideIcon }> = {
  PROJECT_CREATED: { label: "Proyecto creado", icon: FolderPlus },
  PROJECT_UPDATED: { label: "Proyecto actualizado", icon: Pencil },
  DEPLOYMENT_STARTED: { label: "Despliegue iniciado", icon: Rocket },
  DEPLOYMENT_SUCCESS: { label: "Despliegue exitoso", icon: CircleCheck },
  DEPLOYMENT_FAILED: { label: "Despliegue fallido", icon: CircleX },
  DEPLOYMENT_CANCELLED: { label: "Despliegue cancelado", icon: Ban },
  SERVICE_UNAVAILABLE: { label: "Servicio no disponible", icon: WifiOff },
  SERVICE_RECOVERED: { label: "Servicio recuperado", icon: Wifi },
  ACCESS_GRANTED: { label: "Acceso concedido", icon: KeyRound },
  ACCESS_REVOKED: { label: "Acceso revocado", icon: ShieldOff },
  CONFIGURATION_CHANGED: { label: "Configuración modificada", icon: SlidersHorizontal },
};

export const SEVERITY: Record<Severity, { label: string; tone: BadgeTone; dot: string }> = {
  INFO: { label: "Información", tone: "info", dot: "bg-sky-500" },
  WARNING: { label: "Advertencia", tone: "warning", dot: "bg-amber-500" },
  ERROR: { label: "Error", tone: "danger", dot: "bg-red-500" },
  CRITICAL: { label: "Crítico", tone: "danger", dot: "bg-red-700" },
};

export const EVENT_SOURCES: Record<EventSource, string> = {
  SYSTEM: "Sistema",
  USER: "Usuario",
  GITHUB_ACTIONS: "GitHub Actions",
  API: "Integración API",
  MONITORING: "Monitoreo",
};
