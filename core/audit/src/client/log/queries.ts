import { apiRequest } from "@mustawfi/core-config/client";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { auditFacetsSchema, auditPageSchema } from "../../shared/index.ts";

const BASE = "/api/v1/audit";

/** The filters a page of the log is read with (all optional; dates are business dates). */
export interface AuditLogQuery {
  readonly user?: string | undefined;
  readonly action?: string | undefined;
  readonly device?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

/** The log under `query`, a page at a time, newest first (online only). */
export function auditEntriesQueryOptions(query: AuditLogQuery) {
  const filters = {
    user: query.user,
    action: query.action,
    device: query.device,
    from: query.from,
    to: query.to,
  };
  return infiniteQueryOptions({
    queryKey: ["audit", "entries", filters] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) search.set(key, value);
      }
      if (pageParam !== null) search.set("after", pageParam);
      const suffix = search.size === 0 ? "" : `?${search.toString()}`;
      return apiRequest(`${BASE}/entries${suffix}`, { schema: auditPageSchema, signal });
    },
    getNextPageParam: (page) => page.next,
  });
}

/** What the filters offer: the store's users and devices, and the actions its log holds. */
export function auditFacetsQueryOptions() {
  return queryOptions({
    queryKey: ["audit", "facets"] as const,
    queryFn: ({ signal }) => apiRequest(`${BASE}/facets`, { schema: auditFacetsSchema, signal }),
  });
}
