import { zodResolver } from "@hookform/resolvers/zod";
import { Megaphone, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useDeployments } from "@/modules/deployments/hooks";
import { formatDate } from "@/utils/format";
import { applyApiErrors, errorMessage } from "@/utils/forms";

import { useReleaseAction, useReleases, useSaveRelease } from "../releaseHooks";
import { RELEASE_STATUS, type Release } from "../releases";

const schema = z.object({
  version: z.string().trim().regex(/^[\w.+-]{1,50}$/, "Usa letras, números y . _ - + (p. ej. v1.4.0)."),
  title: z.string().trim().max(120, "Máximo 120 caracteres."),
  notes: z.string().trim().max(10000, "Máximo 10 000 caracteres."),
  deployment: z.string(),
});
type Values = z.infer<typeof schema>;

function ReleaseDialog({ project, release, onClose }: { project: string; release?: Release; onClose: () => void }) {
  const save = useSaveRelease(project);
  const toast = useToast();
  const deployments = useDeployments({ project, status: "SUCCESS", page_size: 50 });
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      version: release?.version ?? "",
      title: release?.title ?? "",
      notes: release?.notes ?? "",
      deployment: release?.deployment ?? "",
    },
  });
  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    save.mutate(
      { id: release?.id, payload: { ...values, deployment: values.deployment || null } },
      {
        onSuccess: (r) => {
          toast.success(release ? "Versión actualizada" : "Borrador creado", r.version);
          onClose();
        },
        onError: (e) => setFormError(applyApiErrors(e, setError, ["version", "title", "notes", "deployment"])),
      },
    );
  });
  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={release ? `Editar ${release.version}` : "Nueva versión para clientes"}
      description="Los clientes solo ven las versiones publicadas. Escribe las notas en lenguaje funcional."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="release-form" loading={save.isPending}>
            {release ? "Guardar" : "Crear borrador"}
          </Button>
        </>
      }
    >
      <form id="release-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Versión" required error={errors.version?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} className="font-mono" placeholder="v1.4.0" data-autofocus {...register("version")} />}
          </Field>
          <Field label="Título" error={errors.title?.message}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} placeholder="Pagos con tarjeta" {...register("title")} />}
          </Field>
        </div>
        <Field label="Despliegue asociado" hint="Opcional: despliegue exitoso que contiene esta versión.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} {...register("deployment")}>
              <option value="">Sin asociar</option>
              {deployments.data?.results.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.version} · {d.environment_label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Notas de versión" error={errors.notes?.message} hint="Obligatorias para publicar. Texto plano; los saltos de línea se respetan.">
          {({ id, invalid, describedBy }) => <Textarea id={id} invalid={invalid} aria-describedby={describedBy} rows={7} {...register("notes")} />}
        </Field>
      </form>
    </Modal>
  );
}

export function ReleasesCard({ project, canEdit }: { project: { id: string; is_archived: boolean }; canEdit: boolean }) {
  const releases = useReleases(project.id);
  const action = useReleaseAction();
  const toast = useToast();
  const [editing, setEditing] = useState<Release | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ release: Release; action: "publish" | "withdraw" } | null>(null);
  const editable = canEdit && !project.is_archived;

  return (
    <Card>
      <CardHeader
        title="Versiones para clientes"
        description="Notas de versión que verán las organizaciones con acceso en el portal."
        actions={
          editable && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
              Nueva versión
            </Button>
          )
        }
      />
      {releases.isError ? (
        <ErrorState message={releases.error.message} onRetry={() => void releases.refetch()} />
      ) : releases.isPending ? (
        <div className="p-5">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : releases.data.results.length === 0 ? (
        <EmptyState icon={<Megaphone className="size-5" />} title="Sin versiones compartidas" description="Crea un borrador y publícalo cuando las notas estén listas." />
      ) : (
        <ul className="divide-y divide-border">
          {releases.data.results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-medium text-fg">{r.version}</span>
                  {r.title && <span className="text-fg">{r.title}</span>}
                  <Badge tone={RELEASE_STATUS[r.status].tone} dot>
                    {r.status_label}
                  </Badge>
                </p>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted">{r.notes || "Sin notas"}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {r.published_at ? `Publicada ${formatDate(r.published_at)}` : `Creada ${formatDate(r.created_at)}`}
                  {r.deployment_label && ` · ${r.deployment_label}`}
                </p>
              </div>
              {r.can_edit && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Editar ${r.version}`} onClick={() => setEditing(r)}>
                    <Pencil className="size-4" />
                  </Button>
                  {r.status === "DRAFT" ? (
                    <Button size="sm" onClick={() => setConfirm({ release: r, action: "publish" })}>
                      Publicar
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="text-amber-600" onClick={() => setConfirm({ release: r, action: "withdraw" })}>
                      Retirar
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <ReleaseDialog project={project.id} release={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === "publish" ? "Publicar para clientes" : "Retirar del portal"}
        message={
          confirm?.action === "publish"
            ? `Las organizaciones con acceso verán ${confirm.release.version} y sus notas en el portal.`
            : `${confirm?.release.version} dejará de mostrarse en el portal. El registro se conserva.`
        }
        tone={confirm?.action === "publish" ? "primary" : "danger"}
        confirmLabel={confirm?.action === "publish" ? "Publicar" : "Retirar"}
        loading={action.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          confirm &&
          action.mutate(
            { id: confirm.release.id, action: confirm.action },
            {
              onSuccess: (r) => toast.success(confirm.action === "publish" ? "Versión publicada" : "Versión retirada", r.version),
              onError: (e) => toast.error("No se pudo completar la acción", errorMessage(e)),
              onSettled: () => setConfirm(null),
            },
          )
        }
      />
    </Card>
  );
}
