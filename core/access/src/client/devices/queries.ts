import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { deviceViewSchema, type DeviceView } from "../../shared/index.ts";

const BASE = "/api/v1/access/devices";

export const devicesQueryKey = ["access", "devices"] as const;

/** Every device of the store, revoked ones included (online). */
export function devicesQueryOptions() {
  return queryOptions({
    queryKey: devicesQueryKey,
    queryFn: async ({ signal }) =>
      (await apiRequest(BASE, { schema: z.object({ items: z.array(deviceViewSchema) }), signal }))
        .items,
  });
}

/** Revokes a device with a reason (`core-foundation` rule 23). */
export function revokeDevice(id: string, reason: string): Promise<DeviceView> {
  return apiRequest(`${BASE}/${id}/revoke`, {
    method: "POST",
    body: { reason },
    schema: deviceViewSchema,
  });
}
