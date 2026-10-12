import { Check, Copy, KeyRound, Plus, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Field, Input } from "@/components/ui/Field";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { DataTable, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import type { ServiceToken } from "@/modules/deployments/api";
import { useCreateServiceToken, useRevokeServiceToken, useServiceTokens } from "@/modules/deployments/hooks";
import { endOfDayIso } from "@/modules/projects/constants";
import { useProjects } from "@/modules/projects/hooks";
import { cn } from "@/utils/cn";
import { formatDate, formatRelative } from "@/utils/format";
import { applyApiErrors, errorMessage } from "@/utils/forms";

const STATE = {
  ACTIVE: { label: "Activo", tone: "success" },
  EXPIRED: { label: "Expirado", tone: "warning" },
  REVOKED: { label: "Revocado", tone: "neutral" },
} as const;

function CreateTokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateServiceToken();
  const projects = useProjects({ archived: false, page_size: 100 }, open);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [expires, setExpires] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function close() {
    setName("");
    setSelected([]);
    setExpires("");
    setErrors({});
    setFormError(null);
    setCreated(null);
    setCopied(false);
    onClose();
  }

  function submit() {
    const next: Record<string, string> = {};
    if (name.trim().length < 3) next.name = "Mínimo 3 caracteres.";
    if (selected.length === 0) next.projects = "Selecciona al menos un proyecto.";
    if (expires && new Date(`${expires}T23:59:59`) <= new Date()) next.expires_at = "La fecha debe ser futura.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setFormError(null);
    create.mutate(
      { name: name.trim(), projects: selected, expires_at: endOfDayIso(expires) },
      {
        onSuccess: (t) => setCreated({ token: t.token, name: t.name }),
        onError: (e) => {
          const fieldErrors: Record<string, string> = {};
          const message = applyApiErrors(e, (field, err) => (fieldErrors[field as string] = err.message ?? ""), ["name", "projects", "expires_at"]);
          setErrors(fieldErrors);
          setFormError(message);
        },
      },
    );
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      busy={create.isPending}
      size="lg"
      title={created ? "Token creado" : "Nuevo token de servicio"}
      description={created ? created.name : "Credencial para que GitHub Actions registre despliegues. Solo funciona en los endpoints de integración."}
      footer={
        created ? (
          <Button onClick={close}>Listo, ya lo guardé</Button>
        ) : (
          <>
            <Button variant="outline" onClick={close} disabled={create.isPending}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={create.isPending}>
              Crear token
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4">
          <Alert tone="info">
            <span className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              Copia el token ahora y guárdalo como secreto <code className="font-mono">DEVHUB_TOKEN</code> en GitHub. DevHub solo guarda su
              huella (hash): no podrás volver a verlo.
            </span>
          </Alert>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-fg">
              {created.token}
            </code>
            <Button variant="outline" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Nombre" required error={errors.name} hint="Identifica dónde se usa, p. ej. «GitHub Actions — pedidos».">
            {({ id, invalid, describedBy }) => (
              <Input id={id} invalid={invalid} aria-describedby={describedBy} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
            )}
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-fg">
              Proyectos autorizados <span className="text-red-500">*</span>
            </legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {projects.data?.results.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="text-fg">{p.name}</span>
                  <code className="ml-auto font-mono text-xs text-muted">{p.slug}</code>
                </label>
              ))}
              {projects.isPending && <p className="px-2 py-1.5 text-sm text-muted">Cargando…</p>}
            </div>
            {errors.projects && (
              <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.projects}
              </p>
            )}
          </fieldset>
          <Field label="Expira el" error={errors.expires_at} hint="Recomendado. Vacío = sin expiración.">
            {({ id, invalid, describedBy }) => (
              <Input id={id} type="date" invalid={invalid} aria-describedby={describedBy} value={expires} onChange={(e) => setExpires(e.target.value)} />
            )}
          </Field>
        </div>
      )}
    </Modal>
  );
}

export function IntegrationsPage() {
  const tokens = useServiceTokens();
  const revoke = useRevokeServiceToken();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ServiceToken | null>(null);

  const columns: Column<ServiceToken>[] = [
    {
      key: "name",
      header: "Token",
      cell: (t) => (
        <div>
          <p className="font-medium text-fg">{t.name}</p>
          <p className="font-mono text-xs text-muted">dhs_{t.key_prefix}_••••••••</p>
        </div>
      ),
    },
    {
      key: "projects",
      header: "Proyectos",
      cell: (t) => (
        <div className="flex flex-wrap gap-1">
          {t.projects.map((p) => (
            <Badge key={p.id}>{p.name}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: "state",
      header: "Estado",
      cell: (t) => (
        <Badge tone={STATE[t.state].tone} dot>
          {STATE[t.state].label}
        </Badge>
      ),
    },
    {
      key: "usage",
      header: "Último uso",
      hideOnMobile: true,
      cell: (t) => (
        <span className="text-xs text-muted">
          {t.last_used_at ? formatRelative(t.last_used_at) : "Nunca"}
          <span className="block">{t.expires_at ? `Expira ${formatDate(t.expires_at)}` : "Sin expiración"}</span>
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (t) =>
        t.state !== "REVOKED" && (
          <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setRevoking(t)}>
            Revocar
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader title="Integraciones" description="Credenciales de servicio para que el CI/CD registre despliegues en DevHub." />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardHeader
            title="Tokens de servicio"
            description="Limitados a proyectos concretos; no dan acceso al resto de la API."
            actions={
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Nuevo token
              </Button>
            }
          />
          <DataTable
            caption="Tokens de servicio"
            columns={columns}
            rows={tokens.data?.results}
            rowKey={(t) => t.id}
            loading={tokens.isPending}
            error={tokens.error}
            onRetry={() => void tokens.refetch()}
            empty={<EmptyState icon={<KeyRound className="size-5" />} title="Sin tokens" description="Crea uno para conectar GitHub Actions." />}
          />
        </Card>
        <Card className="h-fit">
          <CardHeader title="Conectar GitHub Actions" />
          <CardBody className="space-y-3 text-sm text-muted">
            <ol className="list-decimal space-y-2 pl-4">
              <li>Crea un token limitado al proyecto.</li>
              <li>
                En el repositorio, agrega los secretos <code className="font-mono text-fg">DEVHUB_URL</code> y{" "}
                <code className="font-mono text-fg">DEVHUB_TOKEN</code>.
              </li>
              <li>
                Copia <code className="font-mono text-fg">scripts/devhub-deploy-report.sh</code> y el workflow de ejemplo{" "}
                <code className="font-mono text-fg">docs/examples/github-actions-deploy.yml</code>.
              </li>
              <li>Cada ejecución registrará el despliegue, sus eventos y la versión del entorno.</li>
            </ol>
            <p className={cn("rounded-lg border border-border bg-surface-2 p-3 text-xs")}>
              Usa solo <code className="font-mono">push</code> a la rama principal o ejecución manual con un environment protegido: nunca{" "}
              <code className="font-mono">pull_request_target</code>.
            </p>
          </CardBody>
        </Card>
      </div>
      <CreateTokenDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={revoking !== null}
        title="Revocar token"
        message={
          <>
            Los workflows que usen <strong>{revoking?.name}</strong> dejarán de poder registrar despliegues de inmediato. Esta acción no se
            puede deshacer.
          </>
        }
        confirmLabel="Revocar"
        loading={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => toast.success("Token revocado", revoking.name),
            onError: (e) => toast.error("No se pudo revocar", errorMessage(e)),
            onSettled: () => setRevoking(null),
          })
        }
      />
    </>
  );
}
