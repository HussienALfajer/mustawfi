import { useClientRuntime } from "@mustawfi/core-config/client";
import { useLocalDb } from "@mustawfi/local-db";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CURRENCY_NAMESPACE } from "../messages.ts";
import { localRatesQueryOptions } from "./queries.ts";
import { type RatesData, staleCurrencies } from "./rates.ts";
import { formatRateInstant } from "./rates-screen.tsx";
import { useNow } from "./use-now.ts";

export interface StaleRateNoticeProps {
  readonly data: RatesData;
  readonly now: Date;
  /**
   * The «set the rate» action (`label` is its text), for holders of `currency.rate.set`; the app
   * composes the link to the rates screen. Absent for everyone else.
   */
  readonly setRate?: ((label: string) => ReactNode) | undefined;
}

/**
 * The stale-rate banner (`core-money` rule 12): while an enabled foreign currency's current rate
 * was set before the start of the business day, or it has none, it says so, with the action to
 * set it for those who may. It never blocks anything: selling goes on at the current rate.
 */
export function StaleRateNotice({ data, now, setRate }: StaleRateNoticeProps) {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  const stale = staleCurrencies(data, now);
  if (stale.length === 0) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-divider bg-warning-tint px-6 py-2 text-text"
    >
      <TriangleAlert
        aria-hidden="true"
        size={18}
        strokeWidth={1.75}
        className="text-text-warning"
      />
      <ul className="flex flex-col gap-1">
        {stale.map((entry) => (
          <li key={entry.currency}>
            {entry.state === "old"
              ? t("stale.old", {
                  currency: t(`name.${entry.currency}`),
                  at: formatRateInstant(entry.rate.effectiveAt),
                })
              : t("stale.missing", { currency: t(`name.${entry.currency}`) })}
          </li>
        ))}
      </ul>
      {setRate === undefined ? null : setRate(t("stale.setRate"))}
    </div>
  );
}

export interface StaleRateBannerProps {
  /** This registered device: its id and its store's base currency. */
  readonly device: { readonly deviceId: string; readonly baseCurrency: string };
  readonly setRate?: ((label: string) => ReactNode) | undefined;
}

/**
 * The stale-rate banner on a registered device, from its own database (offline too), read again
 * when a rate arrives and every minute, so it appears when the business day turns.
 */
export function StaleRateBanner({ device, setRate }: StaleRateBannerProps) {
  const db = useLocalDb();
  const { clock } = useClientRuntime();
  const now = useNow(clock);
  const rates = useQuery(localRatesQueryOptions(db, device));
  if (rates.data === undefined) return null;
  return <StaleRateNotice data={rates.data} now={now} setRate={setRate} />;
}
