import {
  OperationRejected,
  type ReceivedOperation,
  type SyncHandlerDependencies,
  type SyncOperationDefinition,
} from "@mustawfi/core-sync/server";
import type { SyncValues } from "@mustawfi/core-sync/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal } from "@mustawfi/kernel";
import { z } from "zod";
import {
  currencyProblemCodes,
  RATE_SET_OPERATION,
  RATE_SET_PERMISSION,
  ratePairProblem,
  rateSetPayloadV1Schema,
} from "../shared/index.ts";
import { exchangeRateWire, recordExchangeRate, tenantBaseCurrency } from "./rates.ts";

/** The unique constraint a `23505` from the driver names, through its wrapping. */
function uniqueViolation(error: unknown): string | undefined {
  for (let e = error; e instanceof Error; e = e.cause) {
    const fields = e as { code?: unknown; constraint?: unknown };
    if (fields.code === "23505" && typeof fields.constraint === "string") return fields.constraint;
  }
  return undefined;
}

/**
 * Records a rate set on a device (`currency.rate.set`, payload version 1) in `tx`, the sync
 * operation's transaction (`core-money` rules 8–11): stored with the device and operation,
 * audited, and published, whether or not it becomes current — one older than the current rate
 * is history. A device's time later than the server's receipt is taken as the receipt: a rate
 * cannot have applied after the server heard of it, and a clock run ahead must not outrank rates
 * set since. It is never refused for its confirmation, nor for a currency disabled since the
 * device set it; only what cannot be a rate of the store is rejected. The permission is checked
 * by the push (flagged `permissionMissing`, rule 10).
 */
async function setRateV1(
  tx: TenantTransaction,
  operation: ReceivedOperation,
  dependencies: SyncHandlerDependencies,
): Promise<SyncValues> {
  const parsed = rateSetPayloadV1Schema.safeParse(operation.payload);
  if (!parsed.success) {
    throw new OperationRejected(currencyProblemCodes.rateInvalid, z.prettifyError(parsed.error));
  }
  const payload = parsed.data;
  const problem = ratePairProblem(await tenantBaseCurrency(tx), payload);
  if (problem !== undefined) {
    throw new OperationRejected(
      currencyProblemCodes.invalidPair,
      `${payload.quoteCurrency} per 1 ${payload.unitCurrency}: ${problem}`,
    );
  }
  const deviceEffectiveAt = new Date(payload.effectiveAt);
  const ahead = deviceEffectiveAt.getTime() > operation.receivedAt.getTime();
  try {
    const recorded = await recordExchangeRate(
      tx,
      {
        tenantId: operation.tenantId,
        branchId: operation.branchId,
        userId: operation.userId,
        deviceId: operation.device.id,
      },
      {
        id: payload.rateId,
        tenantId: operation.tenantId,
        branchId: operation.branchId,
        unitCurrency: payload.unitCurrency,
        quoteCurrency: payload.quoteCurrency,
        rate: Decimal.of(payload.rate),
        effectiveAt: ahead ? operation.receivedAt : deviceEffectiveAt,
        recordedAt: operation.receivedAt,
        setBy: operation.userId,
        offline: { deviceId: operation.device.id, opId: operation.opId },
      },
      { confirmed: payload.confirmed, ...(ahead ? { deviceEffectiveAt } : {}) },
      dependencies,
    );
    return { rate: { ...exchangeRateWire(recorded.rate) }, current: recorded.current };
  } catch (error) {
    if (uniqueViolation(error) !== "exchange_rates_pkey") throw error;
    throw new OperationRejected(
      currencyProblemCodes.rateDuplicate,
      `rate ${payload.rateId} is recorded already`,
    );
  }
}

/** `currency.rate.set`: a rate set on a device, offline or not, pushed by that device. */
export const rateSetOperation: SyncOperationDefinition = {
  type: RATE_SET_OPERATION,
  access: { permission: RATE_SET_PERMISSION },
  versions: { 1: setRateV1 },
};
