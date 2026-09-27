import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { deviceListSchema, deviceViewSchema, type DeviceView } from "../../shared/index.ts";

const BASE = "/api/v1/access/devices";

export const devicesQueryKey = ["access", "devices"] as const;

/**
 * Every device of the store, revoked ones included, each with its last change, and each device
 * limit as used of allowed (online).
 */
export function devicesQueryOptions() {
  return queryOptions({
    queryKey: devicesQueryKey,
    queryFn: ({ signal }) => apiRequest(BASE, { schema: deviceListSchema, signal }),
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

/** Renames a device; its prefix never changes (`core-foundation` slice 20). */
export function renameDevice(id: string, name: string): Promise<DeviceView> {
  return apiRequest(`${BASE}/${id}`, { method: "PATCH", body: { name }, schema: deviceViewSchema });
}
