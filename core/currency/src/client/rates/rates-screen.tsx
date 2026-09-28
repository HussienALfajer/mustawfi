import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ApiProblem, ApiUnreachable, useClientRuntime } from "@mustawfi/core-config/client";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { DEFAULT_TIME_ZONE, formatDecimal, LOCALE, parseDecimalInput } from "@mustawfi/i18n";
import {
  Badge,
  Button,
  ConfirmDialog,
  FormSection,
  Money,
  TextInput,
  useCurrencyLabel,
  useToast,
} from "@mustawfi/ui";
import { Decimal } from "@mustawfi/kernel";
import { useLocalDb } from "@mustawfi/local-db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CurrencyCode,
  currencyProblemCodes,
  exchangeRateValueSchema,
  quotedPair,
  rateChangePercent,
  type TenantCurrencyView,
} from "../../shared/index.ts";
import { DeviceRateRefused, setDeviceExchangeRate } from "../local-currency.ts";
import { CURRENCY_NAMESPACE } from "../messages.ts";
import {
  localRatesQueryOptions,
  onlineRatesQueryKey,
  onlineRatesQueryOptions,
  setOnlineRate,
} from "./queries.ts";
import {
  currentRateOf,
  isStaleRate,
  type NewRate,
  type RateChange,
  rateChangeToConfirm,
  rateExample,
  type RateLine,
  type RatesData,
} from "./rates.ts";
import { useNow } from "./use-now.ts";

const INSTANT = new Intl.DateTimeFormat(`${LOCALE}-u-nu-latn`, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DEFAULT_TIME_ZONE,
});

/** An instant as the store reads it: its date and time in Damascus, Western digits. */
export function formatRateInstant(iso: string): string {
  return INSTANT.format(new Date(iso));
}

/** What became of a new rate: saved, in need of the user's confirmation, or refused. */
export type RateSetOutcome =
  | { readonly status: "saved" }
  | { readonly status: "confirm"; readonly change: RateChange }
  | { readonly status: "refused"; readonly problem: string };

/** «ل.س لكل 1 $»: how a pair's rate reads (ADR-0031). */
function useDirection(): (pair: {
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
}) => string {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  const label = useCurrencyLabel();
  return (pair) =>
    t("rates.direction", { quote: label(pair.quoteCurrency), unit: label(pair.unitCurrency) });
}

/** A rate's figures: an isolated left-to-right run with tabular digits. */
function RateFigure({ rate, className }: { readonly rate: string; readonly className?: string }) {
  return (
    <bdi dir="ltr" className={`tabular-nums ${className ?? ""}`}>
      {formatDecimal(rate)}
    </bdi>
  );
}

interface CurrencyRateProps {
  readonly data: RatesData;
  readonly currency: TenantCurrencyView;
  readonly now: Date;
  readonly canSet: boolean;
  readonly userName: (rate: RateLine) => string | undefined;
  readonly onSetRate: (rate: NewRate) => Promise<RateSetOutcome>;
}

/**
 * One foreign currency: its current rate against the base, when and by whom it was set, and —
 * for holders of `currency.rate.set` — a one-field form for a new one (`Enter` saves). A change
 * beyond the threshold asks for confirmation with the old rate, the new one, the change, and an
 * example (rule 11).
 */
function CurrencyRate({ data, currency, now, canSet, userName, onSetRate }: CurrencyRateProps) {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  const toast = useToast();
  const direction = useDirection();
  const pair = quotedPair(data.baseCurrency, currency.code);
  const current = currentRateOf(data, currency.code);
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<RateChange | undefined>();
  const name = t(`name.${currency.code}`);

  const send = async (rate: string, confirmed: boolean) => {
    setPending(true);
    setProblem(undefined);
    try {
      const outcome = await onSetRate({ currency: currency.code, ...pair, rate, confirmed });
      if (outcome.status === "confirm") {
        setConfirming(outcome.change);
      } else if (outcome.status === "refused") {
        setConfirming(undefined);
        setProblem(outcome.problem);
      } else {
        setConfirming(undefined);
        setText("");
        toast.show(t("rates.saved", { currency: name, rate: formatDecimal(rate) }));
      }
    } catch (error) {
      // Nothing was saved (the device's database, or the server, failed): said on the screen.
      console.error("the rate was not set", error);
      setConfirming(undefined);
      setProblem("refused");
    } finally {
      setPending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // A second Enter while the rate is being saved would record it twice.
    if (pending) return;
    const parsed = exchangeRateValueSchema.safeParse(parseDecimalInput(text) ?? "");
    if (!parsed.success) {
      setFieldError(t("rates.problem.rateInvalid"));
      return;
    }
    setFieldError(undefined);
    const change = rateChangeToConfirm(current, parsed.data, data.thresholdPercent);
    if (change !== undefined) {
      setConfirming(change);
      return;
    }
    void send(parsed.data, false);
  };

  const by = current === undefined ? undefined : userName(current);
  return (
    <FormSection title={name} description={direction(pair)}>
      {current === undefined ? (
        <p className="text-text-warning">{t("rates.noRate")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-text-secondary">{t("rates.current")}</p>
          <p className="flex flex-wrap items-baseline gap-2">
            <RateFigure rate={current.rate} className="text-2xl font-bold" />
            <span className="text-text-secondary">{direction(pair)}</span>
            {current.pending ? <Badge tone="info">{t("rates.pending")}</Badge> : null}
          </p>
          <p className="text-sm text-text-secondary">
            {by === undefined
              ? t("rates.setAt", { at: formatRateInstant(current.effectiveAt) })
              : t("rates.setAtBy", { at: formatRateInstant(current.effectiveAt), name: by })}
          </p>
          {isStaleRate(current, now) ? (
            <p className="text-text-warning">{t("rates.stale")}</p>
          ) : null}
        </div>
      )}
      {canSet ? (
        <form noValidate onSubmit={submit} className="flex flex-wrap items-start gap-3">
          <TextInput
            label={t("rates.newRate", { direction: direction(pair) })}
            description={t("rates.newRateHelp")}
            errorMessage={fieldError}
            value={text}
            onChange={(value) => {
              setText(value);
              setFieldError(undefined);
            }}
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            className="min-w-0 flex-1 basis-56"
          />
          <Button type="submit" isPending={pending} className="mt-6">
            {t("rates.save")}
          </Button>
        </form>
      ) : null}
      {problem === undefined ? null : (
        <p role="alert" className="text-text-negative">
          {t(`rates.problem.${problem}`)}
        </p>
      )}
      <ConfirmDialog
        isOpen={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title={t("rates.confirm.title")}
        confirmLabel={t("rates.confirm.confirm")}
        cancelLabel={t("rates.confirm.cancel")}
        isPending={pending}
        onConfirm={() => {
          if (confirming !== undefined) void send(confirming.next, true);
        }}
      >
        {confirming === undefined ? null : (
          <div className="flex flex-col gap-3">
            <p>{t("rates.confirm.body", { threshold: data.thresholdPercent })}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-text-secondary">{t("rates.confirm.old")}</dt>
              <dd>
                <RateFigure rate={confirming.current} />
              </dd>
              <dt className="text-text-secondary">{t("rates.confirm.new")}</dt>
              <dd>
                <RateFigure rate={confirming.next} className="font-bold" />
              </dd>
              <dt className="text-text-secondary">{t("rates.confirm.change")}</dt>
              <dd>
                <bdi dir="ltr" className="tabular-nums">
                  {`${confirming.percent.startsWith("-") ? "" : "+"}${formatDecimal(confirming.percent)}%`}
                </bdi>
              </dd>
              <dt className="text-text-secondary">{t("rates.confirm.example")}</dt>
              <dd className="flex flex-wrap items-baseline gap-1">
                <Money value={confirming.example.from} />
                <span aria-hidden="true">=</span>
                <Money value={confirming.example.to} className="font-bold" />
              </dd>
            </dl>
          </div>
        )}
      </ConfirmDialog>
    </FormSection>
  );
}

/** The latest rates: when, which currency, the rate, who set it, and where. */
function RateHistory({
  data,
  userName,
}: {
  readonly data: RatesData;
  readonly userName: (rate: RateLine) => string | undefined;
}) {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  const direction = useDirection();
  const current = new Set(data.current.map((rate) => rate.id));
  const where = (rate: RateLine) =>
    rate.source === "online"
      ? t("rates.history.online")
      : rate.source === "thisDevice"
        ? t("rates.history.thisDevice")
        : (rate.deviceName ?? t("rates.history.otherDevice"));
  return (
    <FormSection title={t("rates.history.title")}>
      {data.history.length === 0 ? (
        <p className="text-text-secondary">{t("rates.history.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-text-secondary">
                <th scope="col" className="p-2 text-start font-medium">
                  {t("rates.history.at")}
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {t("rates.history.currency")}
                </th>
                <th scope="col" className="p-2 text-end font-medium">
                  {t("rates.history.rate")}
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {t("rates.history.by")}
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {t("rates.history.where")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((rate) => (
                <tr key={rate.id} className="border-b border-divider last:border-b-0">
                  <td className="p-2 whitespace-nowrap">
                    <bdi>{formatRateInstant(rate.effectiveAt)}</bdi>
                  </td>
                  <td className="p-2">{direction(rate)}</td>
                  <td className="p-2 text-end">
                    <RateFigure rate={rate.rate} />
                  </td>
                  <td className="p-2">{userName(rate) ?? t("rates.history.unknownUser")}</td>
                  <td className="p-2">
                    <span className="flex flex-wrap items-center gap-2">
                      {where(rate)}
                      {rate.pending ? <Badge tone="info">{t("rates.pending")}</Badge> : null}
                      {current.has(rate.id) ? (
                        <Badge tone="positive">{t("rates.history.current")}</Badge>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
}

export interface RatesViewProps {
  readonly data: RatesData;
  /** The time the stale marks are read against (rule 12). */
  readonly now: Date;
  /** Holds `currency.rate.set`: may set a rate here. */
  readonly canSet: boolean;
  /** Who set a rate, by name, when this client knows it. */
  readonly userName?: (rate: RateLine) => string | undefined;
  readonly onSetRate: (rate: NewRate) => Promise<RateSetOutcome>;
}

/**
 * «Exchange rates» (`core-money` flow 1): each enabled foreign currency with its current rate and
 * a form for a new one, then the latest rates. One column, so it fits a phone.
 */
export function RatesView({ data, now, canSet, userName, onSetRate }: RatesViewProps) {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  const nameOf = (rate: RateLine) => rate.setByName ?? userName?.(rate);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <p className="text-text-secondary">{t("rates.intro")}</p>
      {canSet ? null : <p className="text-text-secondary">{t("rates.readOnly")}</p>}
      {data.foreign.length === 0 ? <p>{t("rates.none")}</p> : null}
      {data.foreign.map((currency) => (
        <CurrencyRate
          key={currency.code}
          data={data}
          currency={currency}
          now={now}
          canSet={canSet}
          userName={nameOf}
          onSetRate={onSetRate}
        />
      ))}
      <RateHistory data={data} userName={nameOf} />
    </div>
  );
}

function Loading({
  failed,
  offline,
  onRetry,
}: {
  readonly failed: boolean;
  readonly offline: boolean;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  if (!failed) return <p className="p-6 text-text-secondary">{t("rates.loading")}</p>;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 p-6 text-text-negative">
      <span>{t(offline ? "rates.offline" : "rates.loadFailed")}</span>
      <Button variant="secondary" onPress={onRetry}>
        {t("rates.retry")}
      </Button>
    </div>
  );
}

export interface DeviceRatesScreenProps {
  /** This registered device: its id and its store's base currency. */
  readonly device: { readonly deviceId: string; readonly baseCurrency: string };
  /** Who is signed in here. */
  readonly userId: string;
  /** The shift the device's operations carry. */
  readonly shiftId: string;
  readonly canSet: boolean;
  /** Who set a rate, by name, from what this device knows of the store's users. */
  readonly userName?: (userId: string) => string | undefined;
  /** Told after a rate is set here, so the app can push it now rather than at the next tick. */
  readonly onRateSet?: () => void;
}

/**
 * The rates screen on a registered device (rule 9): read from its own database and set there,
 * online or not — the rate applies here at once and its operation reaches the server at the
 * next sync.
 */
export function DeviceRatesScreen({
  device,
  userId,
  shiftId,
  canSet,
  userName,
  onRateSet,
}: DeviceRatesScreenProps) {
  const db = useLocalDb();
  const { clock, newId } = useClientRuntime();
  const now = useNow(clock);
  const rates = useQuery(localRatesQueryOptions(db, device));
  if (rates.data === undefined) {
    return (
      <Loading
        failed={rates.isError}
        offline={false}
        onRetry={() => {
          void rates.refetch();
        }}
      />
    );
  }
  return (
    <RatesView
      data={rates.data}
      now={now}
      canSet={canSet}
      {...(userName === undefined ? {} : { userName: (rate) => userName(rate.setBy) })}
      onSetRate={async (rate) => {
        try {
          await setDeviceExchangeRate(db, {
            device,
            userId,
            shiftId,
            unitCurrency: rate.unitCurrency,
            quoteCurrency: rate.quoteCurrency,
            rate: rate.rate,
            confirmed: rate.confirmed,
            clock,
            newId,
          });
        } catch (error) {
          if (!(error instanceof DeviceRateRefused)) throw error;
          if (error.reason === "confirmationRequired" && error.change !== undefined) {
            // A rate arrived since the screen read it: confirm against the one now current.
            return {
              status: "confirm",
              change: {
                current: error.change.current.rate,
                next: rate.rate,
                percent: error.change.percent,
                example: rateExample(rate, rate.rate),
              },
            };
          }
          return { status: "refused", problem: error.reason };
        }
        onRateSet?.();
        return { status: "saved" };
      }}
    />
  );
}

/** The message key of an online refusal, under `rates.problem.`. */
function onlineProblem(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case currencyProblemCodes.invalidPair:
      return "invalidPair";
    case accessProblemCodes.permissionDenied:
      return "permissionDenied";
    case tenancyProblemCodes.licenseReadOnly:
      return "readOnly";
    default:
      return "refused";
  }
}

/**
 * The rates screen on a client that is no registered device (an owner's browser): read from the
 * server and set through the route, so it needs the connection and says so without it.
 */
export function OnlineRatesScreen({ canSet }: { readonly canSet: boolean }) {
  const { clock } = useClientRuntime();
  const now = useNow(clock);
  const queryClient = useQueryClient();
  const rates = useQuery(onlineRatesQueryOptions());
  if (rates.data === undefined) {
    return (
      <Loading
        failed={rates.isError}
        offline={rates.error instanceof ApiUnreachable}
        onRetry={() => {
          void rates.refetch();
        }}
      />
    );
  }
  return (
    <RatesView
      data={rates.data}
      now={now}
      canSet={canSet}
      onSetRate={async (rate) => {
        try {
          await setOnlineRate({
            unitCurrency: rate.unitCurrency,
            quoteCurrency: rate.quoteCurrency,
            rate: rate.rate,
            confirmed: rate.confirmed,
          });
        } catch (error) {
          if (
            error instanceof ApiProblem &&
            error.code === currencyProblemCodes.confirmationRequired
          ) {
            // The rate moved since the screen read it: confirm against the one now current.
            // Asked even when the fresh rate brings the change back within the threshold: the
            // user sees the rate they are replacing before anything is sent again.
            const fresh = await queryClient.fetchQuery(onlineRatesQueryOptions());
            const current = currentRateOf(fresh, rate.currency);
            if (current !== undefined) {
              return {
                status: "confirm",
                change: {
                  current: current.rate,
                  next: rate.rate,
                  percent: rateChangePercent(
                    Decimal.of(current.rate),
                    Decimal.of(rate.rate),
                  ).toString(),
                  example: rateExample(rate, rate.rate),
                },
              };
            }
          }
          return { status: "refused", problem: onlineProblem(error) };
        }
        await queryClient.invalidateQueries({ queryKey: onlineRatesQueryKey });
        return { status: "saved" };
      }}
    />
  );
}
