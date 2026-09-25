import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { departmentSchema, type DepartmentView } from "../../shared/index.ts";

const BASE = "/api/v1/organization/departments";

export const departmentsQueryKey = ["organization", "departments"] as const;

/** Every department of the store, archived ones included, in their order (online). */
export function departmentsQueryOptions() {
  return queryOptions({
    queryKey: departmentsQueryKey,
    queryFn: async ({ signal }) =>
      (
        await apiRequest(BASE, {
          schema: z.object({ items: z.array(departmentSchema) }),
          signal,
        })
      ).items,
  });
}

export function createDepartment(name: string): Promise<DepartmentView> {
  return apiRequest(BASE, { method: "POST", body: { name }, schema: departmentSchema });
}

export function renameDepartment(id: string, name: string): Promise<DepartmentView> {
  return apiRequest(`${BASE}/${id}`, { method: "PATCH", body: { name }, schema: departmentSchema });
}

export function archiveDepartment(id: string): Promise<DepartmentView> {
  return apiRequest(`${BASE}/${id}/archive`, { method: "POST", schema: departmentSchema });
}
