import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { licenseSummarySchema } from "../../shared/index.ts";

export const licenseQueryKey = ["organization", "license"] as const;

/** The «License and plan» summary, by the server's clock (online). */
export function licenseQueryOptions() {
  return queryOptions({
    queryKey: licenseQueryKey,
    queryFn: ({ signal }) =>
      apiRequest("/api/v1/organization/license", { schema: licenseSummarySchema, signal }),
  });
}
