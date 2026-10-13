import { zodResolver } from "@hookform/resolvers/zod";
import { Clock } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { z } from "zod";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useEnvironments } from "@/modules/infrastructure/hooks";
import { applyApiErrors } from "@/utils/forms";

import type { CheckResult, HealthCheck, HealthStatus } from "./api";
import { HEALTH } from "./constants";
import { useSaveHealthCheck } from "./hooks";


/** Status always carries icon + label (never color alone). Stale data shows a clock. */
export function HealthBadge({ status, label, stale = false }: { status: HealthStatus; label?: string; stale?: boolean }) {
  const meta = HEALTH[status];
  const Icon = stale ? Clock : meta.icon;
  return (
    <Badge tone={meta.tone} className="gap-1">
      <Icon className="size-3" aria-hidden />
      {label ?? meta.label}
    </Badge>
  );
}

const schema = z
  .object({
    environment: z.string().min(1, "Selecciona un entorno."),
    path: z
      .string()
      .trim()
      .regex(/^\/[^\s#\\]*$/, "Debe empezar con «/» y no contener espacios ni «#».")
      .refine((v) => !v.startsWith("//") && !v.includes(".."), "No se permite «//» ni «..»."),
    interval_seconds: z.coerce.number().int().min(60, "Mínimo 60 s.").max(86400, "Máximo 24 h."),
    timeout_seconds: z.coerce.number().int().min(1, "Mínimo 1 s.").max(10, "Máximo 10 s."),
    degraded_threshold_ms: z.coerce.number().int().min(100).max(60000),
    failure_threshold: z.coerce.number().int().min(1).max(10),
    expected_status_min: z.coerce.number().int().min(100).max(599),
    expected_status_max: z.coerce.number().int().min(100).max(599),
    enabled: z.boolean(),
  })
  .refine((v) => v.timeout_seconds < v.interval_seconds, { message: "Debe ser menor que el intervalo.", path: ["timeout_seconds"] })
  .refine((v) => v.expected_status_min <= v.expected_status_max, { message: "Rango inválido.", path: ["expected_status_max"] });
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

const FIELDS = [
  "environment",
  "path",
  "interval_seconds",
  "timeout_seconds",
  "degraded_threshold_ms",
  "failure_threshold",
  "expected_status_min",
  "expected_status_max",
] as const;

export function HealthCheckDialog({ check, projectId, onClose }: { check?: HealthCheck; projectId?: string; onClose: () => void }) {
  const save = useSaveHealthCheck();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const environments = useEnvironments({ project: projectId, page_size: 100 }, !check);
  const options = (environments.data?.results ?? []).filter((e) => e.can_edit && e.public_url && e.status === "ACTIVE");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: {
      environment: check?.environment ?? "",
      path: check?.path ?? "/",
      interval_seconds: check?.interval_seconds ?? 300,
      timeout_seconds: check?.timeout_seconds ?? 5,
      degraded_threshold_ms: check?.degraded_threshold_ms ?? 2000,
      failure_threshold: check?.failure_threshold ?? 2,
      expected_status_min: check?.expected_status_min ?? 200,
      expected_status_max: check?.expected_status_max ?? 399,
      enabled: check?.enabled ?? true,
    },
  });
  const onSubmit = handleSubmit(({ environment, ...values }) => {
    setFormError(null);
    save.mutate(
      { id: check?.id, payload: check ? values : { environment, ...values } },
      {
        onSuccess: (c) => {
          toast.success(check ? "Health check actualizado" : "Health check creado", c.target_url);
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, FIELDS)),
      },
    );
  });
  const num = (name: (typeof FIELDS)[number], label: string, hint?: string) => (
    <Field label={label} error={errors[name]?.message} hint={hint}>
      {({ id, invalid, describedBy }) => <Input id={id} type="number" invalid={invalid} aria-describedby={describedBy} {...register(name)} />}
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={check ? "Editar health check" : "Nuevo health check"}
      description="El destino es siempre la URL pública validada del entorno; solo eliges la ruta."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="health-form" loading={save.isPending}>
            {check ? "Guardar" : "Crear"}
          </Button>
        </>
      }
    >
      <form id="health-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        {check ? (
          <p className="text-sm text-muted">
            {check.project_name} · {check.environment_label} — <span className="font-mono">{check.target_url}</span>
          </p>
        ) : (
          <Field label="Entorno" required error={errors.environment?.message}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} data-autofocus {...register("environment")}>
                <option value="">{options.length ? "Selecciona un entorno" : "No hay entornos activos con URL pública"}</option>
                {options.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.project_name} · {e.display_name} — {e.public_url}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Ruta" required error={errors.path?.message} hint="Se añade a la URL pública, p. ej. /health.">
          {({ id, invalid, describedBy }) => <Input id={id} invalid={invalid} aria-describedby={describedBy} className="font-mono" {...register("path")} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          {num("interval_seconds", "Intervalo (s)", "Mínimo 60 s.")}
          {num("timeout_seconds", "Timeout (s)", "1–10 s.")}
          {num("failure_threshold", "Fallos para caída", "Evita falsas alarmas.")}
          {num("degraded_threshold_ms", "Lento a partir de (ms)")}
          {num("expected_status_min", "Código HTTP mínimo")}
          {num("expected_status_max", "Código HTTP máximo")}
        </div>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" {...register("enabled")} /> Activo
        </label>
      </form>
    </Modal>
  );
}

const timeFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "medium" });

interface Point {
  t: number;
  ms: number | null;
  status: HealthStatus;
  error: string;
  code: number | null;
}

function Dot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload || payload.status === "HEALTHY") return null;
  return <circle cx={cx} cy={cy} r={4.5} fill={HEALTH[payload.status].color} stroke="var(--surface)" strokeWidth={2} />;
}

/** Response time (single series) with non-healthy checks marked; failures sit on the baseline. */
export function ResponseTimeChart({ results }: { results: CheckResult[] }) {
  const data: Point[] = results.map((r) => ({
    t: new Date(r.checked_at).getTime(),
    ms: r.response_ms ?? 0,
    status: r.status,
    error: r.error,
    code: r.status_code,
  }));
  return (
    <div className="h-56" role="img" aria-label={`Tiempo de respuesta, ${results.length} verificaciones`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={(t: number) => timeFmt.format(new Date(t))}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} unit=" ms" width={64} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={(p) => {
              const point = p.payload?.[0]?.payload as Point | undefined;
              if (!p.active || !point) return null;
              const meta = HEALTH[point.status];
              const Icon = meta.icon;
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                  <p className="font-medium text-fg">{fullFmt.format(new Date(point.t))}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-muted">
                    <Icon className="size-3.5" style={{ color: meta.color }} /> {meta.label}
                    {point.code !== null && <span className="font-mono">· HTTP {point.code}</span>}
                  </p>
                  <p className="text-fg tabular-nums">{point.status === "UNAVAILABLE" || !point.ms ? "Sin respuesta" : `${point.ms} ms`}</p>
                  {point.error && <p className="mt-0.5 max-w-60 text-muted">{point.error}</p>}
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="ms" stroke="var(--chart-running)" strokeWidth={2} dot={<Dot />} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
