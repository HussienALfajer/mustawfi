import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { hostProblemCodes } from "@mustawfi/core-config/shared";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  enterMovesToNextField,
  FormFooter,
  FormSection,
  Kbd,
  Select,
  TextInput,
  useCurrencyLabel,
  useShortcut,
  useToast,
} from "@mustawfi/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CurrencyCode,
  currencyProblemCodes,
  type CurrencySettingsOverview,
  quotedPair,
} from "../../shared/index.ts";
import { CURRENCY_NAMESPACE } from "../messages.ts";
import { onlineRatesQueryKey } from "../rates/queries.ts";
import {
  currencySettingsQueryKey,
  currencySettingsQueryOptions,
  saveCurrencySettings,
} from "./queries.ts";
import {
  type CurrencyValues,
  fieldOf,
  needsFirstRate,
  readSettings,
  type SettingsErrors,
  settingsDirty,
  settingsValues,
  type SettingsValues,
} from "./settings-values.ts";

/** The message key of a refused save, under `settings.problem.`, and the field it belongs to. */
function refusal(error: unknown): { readonly problem: string; readonly field?: string } {
  if (error instanceof ApiUnreachable) return { problem: "unreachable" };
  if (!(error instanceof ApiProblem)) return { problem: "refused" };
  switch (error.code) {
    case currencyProblemCodes.changeCurrencyInUse:
      return { problem: "changeCurrencyDisabled", field: fieldOf.changeCurrency };
    case currencyProblemCodes.baseDisabled:
      return { problem: "baseDisabled" };
    case currencyProblemCodes.firstRateRequired:
      return { problem: "firstRateRequired" };
    case currencyProblemCodes.firstRateUnexpected:
      return { problem: "firstRateUnexpected" };
    case accessProblemCodes.permissionDenied:
      return { problem: "permissionDenied" };
    case tenancyProblemCodes.licenseReadOnly:
      return { problem: "readOnly" };
    case hostProblemCodes.invalidRequest:
      return { problem: "invalid" };
    default:
      return { problem: "refused" };
  }
}

export interface CurrencySettingsFormProps {
  readonly overview: CurrencySettingsOverview;
  /** Told whenever the form gains or loses unsaved changes, so the app can guard leaving. */
  readonly onDirtyChange?: (dirty: boolean) => void;
}

/**
 * «Currencies» (`core-money` flow 2, settings form): the enabled currencies — enabling one
 * without a rate asks for its first rate — the cash-rounding step of each, the change currency,
 * and the rate-change threshold; a sticky footer with Save (`Ctrl+S`) and discard. `Enter`
 * moves to the next field. Problems the server would refuse are said on their fields first.
 */
export function CurrencySettingsForm({ overview, onDirtyChange }: CurrencySettingsFormProps) {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  const label = useCurrencyLabel();
  const toast = useToast();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<SettingsValues>(() => settingsValues(overview));
  const [errors, setErrors] = useState<SettingsErrors>({});
  const dirty = settingsDirty(overview, values);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const save = useMutation({
    mutationFn: saveCurrencySettings,
    onSuccess: async (next) => {
      toast.show(t("settings.saved"));
      setValues(settingsValues(next));
      setErrors({});
      queryClient.setQueryData(currencySettingsQueryKey, next);
      await queryClient.invalidateQueries({ queryKey: onlineRatesQueryKey });
    },
    onError: (error) => {
      const { field } = refusal(error);
      if (field !== undefined) setErrors({ [field]: refusal(error).problem });
    },
  });
  const submit = () => {
    const read = readSettings(overview, values);
    if (read.errors !== undefined) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    save.mutate(read.request);
  };
  useShortcut({ key: "s", ctrl: true }, () => {
    formRef.current?.requestSubmit();
  });
  const error = (field: string) => {
    const key = errors[field];
    return key === undefined ? undefined : t(`settings.problem.${key}`);
  };
  const setCurrency = (code: CurrencyCode, change: Partial<CurrencyValues>) => {
    setValues((current) => ({
      ...current,
      currencies: current.currencies.map((currency) =>
        currency.code === code ? { ...currency, ...change } : currency,
      ),
    }));
  };
  const name = (code: CurrencyCode) => t(`name.${code}`);
  const direction = (code: CurrencyCode) => {
    const pair = quotedPair(overview.baseCurrency, code);
    return t("rates.direction", {
      quote: label(pair.quoteCurrency),
      unit: label(pair.unitCurrency),
    });
  };
  const wasEnabled = new Set(overview.currencies.filter((c) => c.enabled).map((c) => c.code));
  const changeOptions = values.currencies
    .filter((currency) => currency.enabled || currency.code === values.changeCurrency)
    .map((currency) => ({ id: currency.code, label: name(currency.code) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <form
        ref={formRef}
        noValidate
        onKeyDown={enterMovesToNextField}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex w-full max-w-3xl flex-col gap-6 p-6"
      >
        <FormSection
          title={t("settings.currencies.title")}
          description={t("settings.currencies.description")}
        >
          {values.currencies.map((currency) => {
            const isBase = currency.code === overview.baseCurrency;
            return (
              <div key={currency.code} className="flex flex-col gap-3">
                <Checkbox
                  isSelected={isBase || currency.enabled}
                  isReadOnly={isBase}
                  description={isBase ? t("settings.currencies.base") : undefined}
                  onChange={(enabled) => {
                    setCurrency(currency.code, { enabled });
                  }}
                >
                  {`${name(currency.code)} (${label(currency.code)})`}
                </Checkbox>
                {needsFirstRate(overview, currency) ? (
                  <TextInput
                    label={t("settings.currencies.firstRate", {
                      direction: direction(currency.code),
                    })}
                    description={t(
                      wasEnabled.has(currency.code)
                        ? "settings.currencies.firstRateOptional"
                        : "settings.currencies.firstRateHelp",
                    )}
                    errorMessage={error(fieldOf.firstRate(currency.code))}
                    value={currency.firstRate}
                    onChange={(firstRate) => {
                      setCurrency(currency.code, { firstRate });
                    }}
                    inputMode="decimal"
                    dir="ltr"
                    autoComplete="off"
                    className="ms-8 max-w-xs"
                  />
                ) : null}
              </div>
            );
          })}
        </FormSection>
        <FormSection
          title={t("settings.rounding.title")}
          description={t("settings.rounding.description")}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {values.currencies.map((currency) => (
              <TextInput
                key={currency.code}
                label={t("settings.rounding.step", { currency: label(currency.code) })}
                description={t("settings.rounding.stepHelp")}
                errorMessage={error(fieldOf.step(currency.code))}
                value={currency.cashRoundingStep}
                onChange={(cashRoundingStep) => {
                  setCurrency(currency.code, { cashRoundingStep });
                }}
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
              />
            ))}
          </div>
        </FormSection>
        <FormSection
          title={t("settings.change.title")}
          description={t("settings.change.description")}
        >
          <Select
            label={t("settings.change.label")}
            options={changeOptions}
            value={values.changeCurrency}
            errorMessage={error(fieldOf.changeCurrency)}
            onChange={(changeCurrency) => {
              setValues((current) => ({ ...current, changeCurrency }));
            }}
            className="max-w-xs"
          />
        </FormSection>
        <FormSection
          title={t("settings.threshold.title")}
          description={t("settings.threshold.description")}
        >
          <TextInput
            label={t("settings.threshold.label")}
            description={t("settings.threshold.help")}
            errorMessage={error(fieldOf.threshold)}
            value={values.threshold}
            onChange={(threshold) => {
              setValues((current) => ({ ...current, threshold }));
            }}
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            className="max-w-xs"
          />
        </FormSection>
      </form>
      <FormFooter className="mt-auto">
        <Button
          aria-keyshortcuts="Control+S"
          isPending={save.isPending}
          onPress={() => formRef.current?.requestSubmit()}
        >
          {t("settings.save")}
          <Kbd shortcut="Control+S" />
        </Button>
        {dirty ? (
          <Button
            variant="secondary"
            onPress={() => {
              save.reset();
              setErrors({});
              setValues(settingsValues(overview));
            }}
          >
            {t("settings.cancel")}
          </Button>
        ) : null}
        <p role="status" className="min-h-5 text-sm">
          {dirty ? <span className="text-text-warning">{t("settings.dirty")}</span> : null}
        </p>
        {/* A refused save says why; problems found before sending point to their fields. */}
        {save.error !== null ? (
          <p role="alert" className="text-text-negative">
            {t(`settings.problem.${refusal(save.error).problem}`)}
          </p>
        ) : Object.keys(errors).length > 0 ? (
          <p role="alert" className="text-text-negative">
            {t(`settings.problem.${errors.form ?? "invalid"}`)}
          </p>
        ) : null}
      </FormFooter>
    </div>
  );
}

/** A navigation held back because the form has unsaved changes (the app's router blocks it). */
export interface LeaveGuard {
  readonly proceed: () => void;
  readonly stay: () => void;
}

export interface CurrencySettingsScreenProps {
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Set while the app holds a navigation away from unsaved changes: the screen asks once. */
  readonly leave?: LeaveGuard | undefined;
}

/** The currency settings (settings form), online only: loads them, then edits them. */
export function CurrencySettingsScreen({ onDirtyChange, leave }: CurrencySettingsScreenProps) {
  const { t } = useTranslation(CURRENCY_NAMESPACE);
  const settings = useQuery(currencySettingsQueryOptions());
  return (
    <>
      {settings.data !== undefined ? (
        <CurrencySettingsForm
          overview={settings.data}
          {...(onDirtyChange === undefined ? {} : { onDirtyChange })}
        />
      ) : settings.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 p-6 text-text-negative">
          <span>
            {t(
              settings.error instanceof ApiUnreachable ? "settings.offline" : "settings.loadFailed",
            )}
          </span>
          <Button
            variant="secondary"
            onPress={() => {
              void settings.refetch();
            }}
          >
            {t("settings.retry")}
          </Button>
        </div>
      ) : (
        <p className="p-6 text-text-secondary">{t("settings.loading")}</p>
      )}
      <ConfirmDialog
        isOpen={leave !== undefined}
        onOpenChange={(open) => {
          if (!open) leave?.stay();
        }}
        title={t("settings.leave.title")}
        confirmLabel={t("settings.leave.confirm")}
        cancelLabel={t("settings.leave.cancel")}
        onConfirm={() => {
          leave?.proceed();
        }}
      >
        {t("settings.leave.body")}
      </ConfirmDialog>
    </>
  );
}
