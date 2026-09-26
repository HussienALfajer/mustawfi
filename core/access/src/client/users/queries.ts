import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
  type NewUserRequest,
  type UserChangeRequest,
  userViewSchema,
  type UserView,
} from "../../shared/index.ts";

const BASE = "/api/v1/access/users";

export const usersQueryKey = ["access", "users"] as const;

/** Every user of the store, deactivated ones included (online). */
export function usersQueryOptions() {
  return queryOptions({
    queryKey: usersQueryKey,
    queryFn: async ({ signal }) =>
      (
        await apiRequest(BASE, {
          schema: z.object({ items: z.array(userViewSchema) }),
          signal,
        })
      ).items,
  });
}

export function createUser(user: NewUserRequest): Promise<UserView> {
  return apiRequest(BASE, { method: "POST", body: user, schema: userViewSchema });
}

export function changeUser(id: string, change: UserChangeRequest): Promise<UserView> {
  return apiRequest(`${BASE}/${id}`, { method: "PATCH", body: change, schema: userViewSchema });
}

export function deactivateUser(id: string, reason: string): Promise<UserView> {
  return apiRequest(`${BASE}/${id}/deactivate`, {
    method: "POST",
    body: { reason },
    schema: userViewSchema,
  });
}

export function reactivateUser(id: string): Promise<UserView> {
  return apiRequest(`${BASE}/${id}/reactivate`, { method: "POST", schema: userViewSchema });
}

export function clearUserTwoFactor(id: string, reason: string): Promise<UserView> {
  return apiRequest(`${BASE}/${id}/two-factor/clear`, {
    method: "POST",
    body: { reason },
    schema: userViewSchema,
  });
}

export function setUserPin(id: string, pin: string): Promise<UserView> {
  return apiRequest(`${BASE}/${id}/pin`, { method: "PUT", body: { pin }, schema: userViewSchema });
}

export function setUserPassword(id: string, password: string): Promise<UserView> {
  return apiRequest(`${BASE}/${id}/password`, {
    method: "PUT",
    body: { password },
    schema: userViewSchema,
  });
}
