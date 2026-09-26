import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
  type AccountView,
  accountViewSchema,
  recoveryCodesSchema,
  type TwoFactorEnrolment,
  twoFactorEnrolmentSchema,
} from "../../shared/index.ts";

const BASE = "/api/v1/access/me";

export const accountQueryKey = ["access", "me"] as const;

/** The signed-in user's own account (online). */
export function accountQueryOptions() {
  return queryOptions({
    queryKey: accountQueryKey,
    queryFn: ({ signal }): Promise<AccountView> =>
      apiRequest(BASE, { schema: accountViewSchema, signal }),
  });
}

/** The proof of a change of one's own: the current secret of that kind, or of the other. */
export interface CurrentSecret {
  readonly currentPin?: string | undefined;
  readonly currentPassword?: string | undefined;
}

export async function changeOwnPin(proof: CurrentSecret, pin: string): Promise<void> {
  await apiRequest(`${BASE}/pin`, {
    method: "PUT",
    body: { ...proof, pin },
    schema: z.null(),
  });
}

export async function changeOwnPassword(proof: CurrentSecret, password: string): Promise<void> {
  await apiRequest(`${BASE}/password`, {
    method: "PUT",
    body: { ...proof, password },
    schema: z.null(),
  });
}

export function startTwoFactor(currentPassword: string): Promise<TwoFactorEnrolment> {
  return apiRequest(`${BASE}/two-factor/enrolment`, {
    method: "POST",
    body: { currentPassword },
    schema: twoFactorEnrolmentSchema,
  });
}

export async function confirmTwoFactor(code: string): Promise<readonly string[]> {
  const { recoveryCodes } = await apiRequest(`${BASE}/two-factor/confirm`, {
    method: "POST",
    body: { code },
    schema: recoveryCodesSchema,
  });
  return recoveryCodes;
}

export async function disableTwoFactor(currentPassword: string, code: string): Promise<void> {
  await apiRequest(`${BASE}/two-factor/disable`, {
    method: "POST",
    body: { currentPassword, code },
    schema: z.null(),
  });
}
