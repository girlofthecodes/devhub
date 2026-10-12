import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { eventsApi, type EventListParams } from "./api";

export function useEvents(params: EventListParams, enabled = true) {
  return useQuery({
    queryKey: ["events", params],
    queryFn: () => eventsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}
