import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { ToastProvider } from "@/components/ui/Toast";
import { meQueryKey } from "@/modules/auth/hooks";
import { ApiError, onUnauthenticated } from "@/services/http";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
          failureCount < 2,
      },
    },
  });
}

/** When any request reports the session is gone (expired/revoked), reset the user. */
function SessionWatcher({ client }: { client: QueryClient }) {
  useEffect(
    () =>
      onUnauthenticated(() => {
        if (client.getQueryData(meQueryKey)) client.setQueryData(meQueryKey, null);
      }),
    [client],
  );
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <SessionWatcher client={client} />
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
