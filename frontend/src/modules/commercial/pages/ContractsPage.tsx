import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { Pagination, SearchInput } from "@/components/ui/Table";
import { useDebounce } from "@/hooks/useDebounce";

import type { ContractKind, ContractStatus } from "../api";
import { CONTRACT_STATUS, KIND_LABEL } from "../constants";
import { ContractFormDialog } from "../components/dialogs";
import { FinanceGate } from "../components/filters";
import { ContractsTable } from "../components/tables";
import { useApplicationOptions, useContracts, useFinanceAccess } from "../hooks";

const PAGE_SIZE = 20;

export function ContractsPage() {
  return (
    <FinanceGate>
      <Contracts />
    </FinanceGate>
  );
}

function Contracts() {
  const { canManage } = useFinanceAccess();
  const navigate = useNavigate();
  const apps = useApplicationOptions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ContractStatus | "">("");
  const [kind, setKind] = useState<ContractKind | "">("");
  const [project, setProject] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search, 300);
  const contracts = useContracts({ page, page_size: PAGE_SIZE, search: debounced, status, kind, project });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Contratos"
        description="Ventas únicas y rentas por aplicación y organización cliente. Nunca se eliminan: se cancelan o finalizan."
        actions={
          canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Registrar contrato
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-border p-4">
          <SearchInput value={search} onChange={reset(setSearch)} placeholder="Buscar aplicación u organización…" className="w-full sm:w-72" />
          <Select aria-label="Aplicación" className="w-full sm:w-52" value={project} onChange={(e) => reset(setProject)(e.target.value)}>
            <option value="">Todas las aplicaciones</option>
            {apps.data?.results.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Modelo comercial" className="w-full sm:w-48" value={kind} onChange={(e) => reset(setKind)(e.target.value as ContractKind | "")}>
            <option value="">Venta y renta</option>
            {(Object.keys(KIND_LABEL) as ContractKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Select aria-label="Estado" className="w-full sm:w-44" value={status} onChange={(e) => reset(setStatus)(e.target.value as ContractStatus | "")}>
            <option value="">Todos los estados</option>
            {(Object.keys(CONTRACT_STATUS) as ContractStatus[]).map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS[s].label}
              </option>
            ))}
          </Select>
        </div>
        <ContractsTable rows={contracts.data?.results} loading={contracts.isPending} error={contracts.error} onRetry={() => void contracts.refetch()} />
        {contracts.data && contracts.data.count > PAGE_SIZE && (
          <Pagination page={page} pageSize={PAGE_SIZE} count={contracts.data.count} onPageChange={setPage} />
        )}
      </Card>
      <ContractFormDialog open={creating} onClose={() => setCreating(false)} onCreated={(c) => navigate(`/admin/business/contracts/${c.id}`)} />
    </>
  );
}
