import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useEnvironments } from "@/modules/infrastructure/hooks";
import { applyApiErrors } from "@/utils/forms";
import { publicUrlError } from "@/utils/urls";

import type { Deployment, DeploymentStatus } from "../api";
import { DEPLOYMENT_STATUS } from "../constants";
import { useCreateDeployment, useTransitionDeployment } from "../hooks";

const deploymentSchema = z.object({
  environment: z.string().min(1, "Selecciona un entorno."),
  version: z
    .string()
    .trim()
    .regex(/^[\w.+-]{1,50}$/, "Usa letras, números y . _ - + (p. ej. v1.4.0)."),
  commit_sha: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^([0-9a-f]{7,40})?$/, "SHA de commit no válido (7–40 caracteres hex)."),
  branch: z
    .string()
    .trim()
    .regex(/^([\w./-]{1,120})?$/, "Nombre de rama no válido."),
  ci_run_url: z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const error = publicUrlError(v);
      if (error) ctx.addIssue({ code: "custom", message: error });
    }),
  status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED"]),
  message: z.string().trim().max(2000, "Máximo 2000 caracteres."),
});
type DeploymentValues = z.infer<typeof deploymentSchema>;

const FIELDS = ["environment", "version", "commit_sha", "branch", "ci_run_url", "status", "message"] as const;

const INITIAL_STATUS_HELP: Record<DeploymentValues["status"], string> = {
  PENDING: "Se registra en espera; podrás iniciarlo después.",
  RUNNING: "Se marca como iniciado ahora.",
  SUCCESS: "Registra un despliegue ya completado: actualiza la versión del entorno.",
  FAILED: "Registra un despliegue que ya falló.",
};

interface RegisterProps {
  open: boolean;
  onClose: () => void;
  /** Restrict environment choices to one project. */
  projectId?: string;
  onCreated?: (deployment: Deployment) => void;
}

export function RegisterDeploymentDialog(props: RegisterProps) {
  if (!props.open) return null;
  return <RegisterDeploymentForm {...props} />;
}

function RegisterDeploymentForm({ onClose, projectId, onCreated }: RegisterProps) {
  const create = useCreateDeployment();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const environments = useEnvironments({ project: projectId, page_size: 100 });
  const options = (environments.data?.results ?? []).filter((e) => e.can_edit && e.status !== "INACTIVE");
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<DeploymentValues>({
    resolver: zodResolver(deploymentSchema),
    defaultValues: { environment: "", version: "", commit_sha: "", branch: "", ci_run_url: "", status: "SUCCESS", message: "" },
  });
  const status = useWatch({ control, name: "status" });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    create.mutate(values, {
      onSuccess: (dep) => {
        toast.success("Despliegue registrado", `${dep.project_name} · ${dep.environment_label} · ${dep.version}`);
        onClose();
        onCreated?.(dep);
      },
      onError: (e) => setFormError(applyApiErrors(e, setError, FIELDS)),
    });
  });

  return (
    <Modal
      open
      onClose={onClose}
      busy={create.isPending}
      size="lg"
      title="Registrar despliegue"
      description="Registro manual. Los despliegues desde GitHub Actions se registran solos con un token de servicio."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="deployment-form" loading={create.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="deployment-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entorno" required error={errors.environment?.message} className="sm:col-span-2">
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} disabled={environments.isPending} data-autofocus {...register("environment")}>
                <option value="">
                  {environments.isPending ? "Cargando…" : options.length ? "Selecciona un entorno" : "No hay entornos en los que puedas desplegar"}
                </option>
                {options.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.project_name} · {e.display_name} {e.deployed_version ? `(actual: ${e.deployed_version})` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Versión" required error={errors.version?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} className="font-mono" placeholder="v1.4.0" {...register("version")} />}
          </Field>
          <Field label="Estado inicial" required error={errors.status?.message} hint={INITIAL_STATUS_HELP[status]}>
            {({ id, invalid, describedBy }) => (
              <Select id={id} invalid={invalid} aria-describedby={describedBy} {...register("status")}>
                {(["SUCCESS", "FAILED", "RUNNING", "PENDING"] as const).map((s) => (
                  <option key={s} value={s}>
                    {DEPLOYMENT_STATUS[s].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Commit" error={errors.commit_sha?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} className="font-mono" placeholder="a1b2c3d" {...register("commit_sha")} />}
          </Field>
          <Field label="Rama" error={errors.branch?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} className="font-mono" placeholder="main" {...register("branch")} />}
          </Field>
        </div>
        <Field label="URL de la ejecución CI/CD" error={errors.ci_run_url?.message}>
          {({ id, invalid }) => <Input id={id} invalid={invalid} placeholder="https://github.com/org/repo/actions/runs/…" {...register("ci_run_url")} />}
        </Field>
        <Field label="Mensaje de resultado" error={errors.message?.message}>
          {({ id, invalid }) => <Textarea id={id} invalid={invalid} rows={2} {...register("message")} />}
        </Field>
      </form>
    </Modal>
  );
}

interface TransitionProps {
  deployment: Deployment;
  target: Exclude<DeploymentStatus, "PENDING"> | null;
  onClose: () => void;
}

const TARGET_COPY: Record<Exclude<DeploymentStatus, "PENDING">, { title: string; action: string; tone: "primary" | "danger" }> = {
  RUNNING: { title: "Iniciar despliegue", action: "Marcar en ejecución", tone: "primary" },
  SUCCESS: { title: "Marcar como exitoso", action: "Marcar exitoso", tone: "primary" },
  FAILED: { title: "Marcar como fallido", action: "Marcar fallido", tone: "danger" },
  CANCELLED: { title: "Cancelar despliegue", action: "Cancelar despliegue", tone: "danger" },
};

export function TransitionDialog({ deployment, target, onClose }: TransitionProps) {
  const transition = useTransitionDeployment();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!target) return null;
  const copy = TARGET_COPY[target];

  function close() {
    setMessage("");
    setError(null);
    onClose();
  }

  return (
    <Modal
      open
      onClose={close}
      busy={transition.isPending}
      title={copy.title}
      description={`${deployment.project_name} · ${deployment.environment_label} · ${deployment.version}`}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={transition.isPending}>
            Volver
          </Button>
          <Button
            variant={copy.tone === "danger" ? "danger" : "primary"}
            loading={transition.isPending}
            onClick={() =>
              transition.mutate(
                { id: deployment.id, status: target, message: message.trim() },
                {
                  onSuccess: (d) => {
                    toast.success(`Despliegue ${DEPLOYMENT_STATUS[d.status].label.toLowerCase()}`, d.version);
                    close();
                  },
                  onError: (e) => setError(e instanceof Error ? e.message : "Error inesperado."),
                },
              )
            }
          >
            {copy.action}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="flex items-center gap-2 text-sm text-muted">
          <Badge tone={DEPLOYMENT_STATUS[deployment.status].tone}>{deployment.status_label}</Badge>→
          <Badge tone={DEPLOYMENT_STATUS[target].tone}>{DEPLOYMENT_STATUS[target].label}</Badge>
        </p>
        {target === "SUCCESS" && (
          <Alert tone="info">La versión del entorno pasará a {deployment.version}. Los estados finales no se pueden modificar.</Alert>
        )}
        <Field label="Mensaje (opcional)">
          {({ id }) => <Textarea id={id} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />}
        </Field>
      </div>
    </Modal>
  );
}
