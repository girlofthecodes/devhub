import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/modules/auth/hooks";

import { commercialApi, type PeriodFilters } from "./api";

type Params = Parameters<typeof commercialApi.contracts>[0];

/** UX only: the server enforces finance permissions on every endpoint. */
export function useFinanceAccess() {
  const { data } = useCurrentUser();
  const level = data?.finance_access ?? "NONE";
  return { canView: level !== "NONE", canManage: level === "MANAGE" };
}

export function useApplications(params: Params, enabled = true) {
  return useQuery({
    queryKey: ["commercial", "applications", params],
    queryFn: () => commercialApi.applications(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Every non-archived project, for selectors (catalog shared with the projects module). */
export function useApplicationOptions(enabled = true) {
  return useApplications({ page_size: 100, ordering: "name" }, enabled);
}

export function useApplication(id: string) {
  return useQuery({ queryKey: ["commercial", "application", id], queryFn: () => commercialApi.application(id) });
}

export function useProjectProfitability(id: string, filters: Omit<PeriodFilters, "project">, enabled = true) {
  return useQuery({
    queryKey: ["commercial", "profitability", id, filters],
    queryFn: () => commercialApi.profitability(id, filters),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFinanceSummary(filters: PeriodFilters) {
  return useQuery({
    queryKey: ["commercial", "summary", filters],
    queryFn: () => commercialApi.summary(filters),
    placeholderData: keepPreviousData,
  });
}

export function useRecurring(filters: PeriodFilters) {
  return useQuery({
    queryKey: ["commercial", "recurring", filters],
    queryFn: () => commercialApi.recurring(filters),
    placeholderData: keepPreviousData,
  });
}

export function useUpcoming(project?: string) {
  return useQuery({ queryKey: ["commercial", "upcoming", project], queryFn: () => commercialApi.upcoming({ project }) });
}

export function useContracts(params: Params) {
  return useQuery({
    queryKey: ["commercial", "contracts", params],
    queryFn: () => commercialApi.contracts(params),
    placeholderData: keepPreviousData,
  });
}

export function useContract(id: string) {
  return useQuery({ queryKey: ["commercial", "contract", id], queryFn: () => commercialApi.contract(id) });
}

export function useReceivables(params: Params, enabled = true) {
  return useQuery({
    queryKey: ["commercial", "receivables", params],
    queryFn: () => commercialApi.receivables(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePayments(params: Params, enabled = true) {
  return useQuery({
    queryKey: ["commercial", "payments", params],
    queryFn: () => commercialApi.payments(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useExpenses(params: Params) {
  return useQuery({
    queryKey: ["commercial", "expenses", params],
    queryFn: () => commercialApi.expenses(params),
    placeholderData: keepPreviousData,
  });
}

/** Any financial write can change every indicator: refresh the whole module. */
function useFinanceMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["commercial"] });
      // Activating or closing a contract may grant or revoke portal access.
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["project-access"] });
    },
  });
}

export const useUpdateProfile = () =>
  useFinanceMutation((a: { id: string; payload: Parameters<typeof commercialApi.updateProfile>[1] }) =>
    commercialApi.updateProfile(a.id, a.payload),
  );
export const useCreateContract = () => useFinanceMutation(commercialApi.createContract);
export const useUpdateContract = () =>
  useFinanceMutation((a: { id: string; payload: Parameters<typeof commercialApi.updateContract>[1] }) =>
    commercialApi.updateContract(a.id, a.payload),
  );
export const useTransition = () =>
  useFinanceMutation((a: { id: string; payload: Parameters<typeof commercialApi.transition>[1] }) =>
    commercialApi.transition(a.id, a.payload),
  );
export const useChangePrice = () =>
  useFinanceMutation((a: { id: string; payload: Parameters<typeof commercialApi.changePrice>[1] }) =>
    commercialApi.changePrice(a.id, a.payload),
  );
export const useGenerateReceivable = () => useFinanceMutation(commercialApi.generateReceivable);
export const useCreateReceivable = () => useFinanceMutation(commercialApi.createReceivable);
export const useUpdateReceivable = () =>
  useFinanceMutation((a: { id: string; payload: Parameters<typeof commercialApi.updateReceivable>[1] }) =>
    commercialApi.updateReceivable(a.id, a.payload),
  );
export const useCancelReceivable = () =>
  useFinanceMutation((a: { id: string; reason: string }) => commercialApi.cancelReceivable(a.id, a.reason));
export const useRecordPayment = () => useFinanceMutation(commercialApi.recordPayment);
export const useReversePayment = () =>
  useFinanceMutation((a: { id: string; reason: string }) => commercialApi.reversePayment(a.id, a.reason));
export const useCorrectPayment = () =>
  useFinanceMutation((a: { id: string; payload: Parameters<typeof commercialApi.correctPayment>[1] }) =>
    commercialApi.correctPayment(a.id, a.payload),
  );
export const useCreateExpense = () => useFinanceMutation(commercialApi.createExpense);
export const useUpdateExpense = () =>
  useFinanceMutation((a: { id: string; payload: Parameters<typeof commercialApi.updateExpense>[1] }) =>
    commercialApi.updateExpense(a.id, a.payload),
  );
export const useVoidExpense = () =>
  useFinanceMutation((a: { id: string; reason: string }) => commercialApi.voidExpense(a.id, a.reason));
export const useSetAllocations = () =>
  useFinanceMutation((a: { id: string; allocations: { project: string; percentage: string }[] }) =>
    commercialApi.setAllocations(a.id, a.allocations),
  );
