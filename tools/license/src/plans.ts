import type { LicenseLimits } from "@mustawfi/core-tenancy/shared";

/**
 * The plans until the admin console holds them (`core-foundation` → Plans, `v1-scope.md` §6).
 * The license carries the resolved values, so the tenant server never reads this table.
 */
export interface Plan {
  /** Modules beyond the core platform; `core-config` enforces them. */
  readonly entitlements: readonly string[];
  readonly limits: LicenseLimits;
}

/** Base modules and the customer portal, in every plan. */
const BASE_MODULES = [
  "inventory",
  "treasury",
  "customers",
  "sales",
  "purchases",
  "reports",
  "customer-portal",
];

export const PLANS = {
  basic: {
    entitlements: BASE_MODULES,
    limits: { users: 3, departments: 2, mainPosDevices: 1, companionDevices: 2 },
  },
  phonesPro: {
    entitlements: [...BASE_MODULES, "serials", "repairs", "recharge"],
    limits: { users: 6, departments: 4, mainPosDevices: 3, companionDevices: 2 },
  },
  supermarketPro: {
    entitlements: [...BASE_MODULES, "weighted"],
    limits: { users: 6, departments: 3, mainPosDevices: 3, companionDevices: 2 },
  },
} as const satisfies Record<string, Plan>;

export type PlanCode = keyof typeof PLANS;

export function isPlanCode(code: string): code is PlanCode {
  return Object.hasOwn(PLANS, code);
}

/**
 * Commercial defaults until the admin console (`core-foundation` → Open questions): grace 7
 * days, read-only 30 days, maximum offline 10 days, and one year of validity.
 */
export const LICENSE_DEFAULTS = {
  graceDays: 7,
  readOnlyDays: 30,
  maxOfflineDays: 10,
  validDays: 365,
} as const;
