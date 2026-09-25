import { apiBlob, apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import {
  type StoreProfileInput,
  storeProfileSchema,
  type StoreProfileView,
} from "../../shared/index.ts";

const BASE = "/api/v1/organization/profile";

export const storeProfileQueryKey = ["organization", "profile"] as const;

/** The store profile as the server holds it (online). */
export function storeProfileQueryOptions() {
  return queryOptions({
    queryKey: storeProfileQueryKey,
    queryFn: ({ signal }) => apiRequest(BASE, { schema: storeProfileSchema, signal }),
  });
}

/** The logo's image, by its hash: a new logo is a new query, the old one stays cached. */
export function storeLogoQueryOptions(sha256: string) {
  return queryOptions({
    queryKey: [...storeProfileQueryKey, "logo", sha256] as const,
    queryFn: ({ signal }) => apiBlob(`${BASE}/logo`, { signal }),
    staleTime: Infinity,
  });
}

export function saveStoreProfile(input: StoreProfileInput): Promise<StoreProfileView> {
  return apiRequest(BASE, { method: "PUT", body: input, schema: storeProfileSchema });
}

/** Base64 of `bytes`, in chunks so a large image does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** Uploads the logo's bytes, base64-encoded; the server checks their type and size again. */
export function uploadStoreLogo(bytes: Uint8Array): Promise<StoreProfileView> {
  return apiRequest(`${BASE}/logo`, {
    method: "PUT",
    body: { data: bytesToBase64(bytes) },
    schema: storeProfileSchema,
  });
}

export function removeStoreLogo(): Promise<StoreProfileView> {
  return apiRequest(`${BASE}/logo`, { method: "DELETE", schema: storeProfileSchema });
}
