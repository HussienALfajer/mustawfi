import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
  permissionCatalogueSchema,
  type RoleRequest,
  roleViewSchema,
  type RoleView,
} from "../../shared/index.ts";

const BASE = "/api/v1/access";

export type PermissionCatalogueView = z.infer<typeof permissionCatalogueSchema>;

export const catalogueQueryKey = ["access", "catalogue"] as const;
export const rolesQueryKey = ["access", "roles"] as const;

/** Every permission and limit the server's modules declare, for the permission matrix. */
export function catalogueQueryOptions() {
  return queryOptions({
    queryKey: catalogueQueryKey,
    queryFn: ({ signal }) =>
      apiRequest(`${BASE}/catalogue`, { schema: permissionCatalogueSchema, signal }),
    staleTime: Infinity,
  });
}

/** Every role of the store, archived ones included (online). */
export function rolesQueryOptions() {
  return queryOptions({
    queryKey: rolesQueryKey,
    queryFn: async ({ signal }) =>
      (
        await apiRequest(`${BASE}/roles`, {
          schema: z.object({ items: z.array(roleViewSchema) }),
          signal,
        })
      ).items,
  });
}

/** A new role: a copy of another, or an empty one; the client sends what it holds. */
export function createRole(role: RoleRequest): Promise<RoleView> {
  return apiRequest(`${BASE}/roles`, { method: "POST", body: role, schema: roleViewSchema });
}

export function updateRole(id: string, role: RoleRequest): Promise<RoleView> {
  return apiRequest(`${BASE}/roles/${id}`, { method: "PUT", body: role, schema: roleViewSchema });
}

export function archiveRole(id: string): Promise<RoleView> {
  return apiRequest(`${BASE}/roles/${id}/archive`, { method: "POST", schema: roleViewSchema });
}
