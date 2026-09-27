import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import {
  type NewUserRequest,
  type UserChangeRequest,
  userListSchema,
  userViewSchema,
  type UserView,
} from "../../shared/index.ts";

const BASE = "/api/v1/access/users";

export const usersQueryKey = ["access", "users"] as const;

/**
 * The users list as the server answers it: every user of the store, deactivated ones included,
 * and the user limit as used of allowed (online).
 */
export function userListQueryOptions() {
  return queryOptions({
    queryKey: usersQueryKey,
    queryFn: ({ signal }) => apiRequest(BASE, { schema: userListSchema, signal }),
  });
}

/** Every user of the store, deactivated ones included (online). */
export function usersQueryOptions() {
  return queryOptions({ ...userListQueryOptions(), select: (list) => list.items });
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
