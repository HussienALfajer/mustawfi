import { ApiUnreachable } from "@mustawfi/core-config/client";
import type { LicenseState } from "@mustawfi/core-tenancy/shared";
import { DEFAULT_TIME_ZONE, LOCALE } from "@mustawfi/i18n";
import { Badge, type BadgeTone, Button, FormSection } from "@mustawfi/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LicenseLimitName, LicenseSummary } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import { licenseQueryOptions } from "./queries.ts";

const DATE = new Intl.DateTimeFormat(`${LOCALE}-u-nu-latn`, {
  dateStyle: "long",
  timeZone: DEFAULT_TIME_ZONE,
});

/** A date as the store reads it: in Damascus, Western digits. */
const formatDate = (iso: string) => DATE.format(new Date(iso));

const STATE_TONES: Record<LicenseState, BadgeTone> = {
  active: "positive",
  expiring: "warning",
  grace: "warning",
  readOnly: "negative",
  suspended: "negative",
};

const EXPLANATION_COLOURS: Record<LicenseState, string> = {
  active: "text-text",
  expiring: "text-text-warning",
  grace: "text-text-warning",
  readOnly: "text-text-negative",
  suspended: "text-text-negative",
};

export interface LicenseScreenProps {
  /**
   * The link to where a limit is managed (users, departments, devices), when the signed-in user
   * may open that screen; the app composes it, since routes are the app's.
   */
  readonly limitLink?: (limit: LicenseLimitName) => ReactNode;
}

/**
 * «License and plan» (summary, `screen-patterns.md`), online only: the plan, the lifecycle state
 * by the server's clock with what it means and when the next one begins, and each limit as used
 * of allowed (`core-foundation` rules 3 and 4). Renewal is done by Vertex staff, so the screen
 * only says whom to ask.
 */
export function LicenseScreen({ limitLink }: LicenseScreenProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const license = useQuery(licenseQueryOptions());
  if (license.data !== undefined) {
    return (
      <LicenseSummaryView
        summary={license.data}
        {...(limitLink === undefined ? {} : { limitLink })}
      />
    );
  }
  if (license.isError) {
    return (
      <div role="alert" className="flex items-center gap-3 p-6 text-text-negative">
        <span>
          {t(license.error instanceof ApiUnreachable ? "license.offline" : "license.loadFailed")}
        </span>
        <Button
          variant="secondary"
          onPress={() => {
            void license.refetch();
          }}
        >
          {t("license.retry")}
        </Button>
      </div>
    );
  }
  return <p className="p-6 text-text-secondary">{t("license.loading")}</p>;
}

function LicenseSummaryView({
  summary,
  limitLink,
}: {
  readonly summary: LicenseSummary;
  readonly limitLink?: (limit: LicenseLimitName) => ReactNode;
}) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const dates = {
    expiresAt: formatDate(summary.expiresAt),
    readOnlyAt: formatDate(summary.readOnlyAt),
    suspendedAt: formatDate(summary.suspendedAt),
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex w-full max-w-3xl flex-col gap-6 p-6">
        <FormSection title={t("license.plan.title")}>
          <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-8 gap-y-3">
            <dt className="text-text-secondary">{t("license.plan.name")}</dt>
            <dd className="font-semibold">
              {t(`license.plan.names.${summary.plan}`, { defaultValue: summary.plan })}
            </dd>
            <dt className="text-text-secondary">{t("license.plan.state")}</dt>
            <dd>
              <Badge tone={STATE_TONES[summary.state]}>{t(`license.state.${summary.state}`)}</Badge>
            </dd>
            <dt className="text-text-secondary">{t("license.plan.expiresAt")}</dt>
            <dd className="tabular-nums">{dates.expiresAt}</dd>
          </dl>
          <p className={EXPLANATION_COLOURS[summary.state]}>
            {t(`license.explain.${summary.state}`, dates)}
          </p>
          <p className="text-text-secondary">{t("license.plan.renew")}</p>
        </FormSection>
        <FormSection
          title={t("license.limits.title")}
          description={t("license.limits.description")}
        >
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-divider text-text-secondary">
                <th scope="col" className="py-2 text-start font-medium">
                  {t("license.limits.limit")}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t("license.limits.usage")}
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">{t("license.plan.state")}</span>
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">{t("license.limits.manage")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.limits.map(({ limit, used, allowed }) => (
                <tr key={limit} className="border-b border-divider last:border-b-0">
                  <th scope="row" className="py-2 text-start font-normal">
                    {t(`license.limits.name.${limit}`)}
                  </th>
                  <td className="py-2 text-end tabular-nums">
                    {t("license.limits.usedOfAllowed", { used, allowed })}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {used > allowed ? (
                      <Badge tone="negative">{t("license.limits.over")}</Badge>
                    ) : used === allowed ? (
                      <Badge tone="warning">{t("license.limits.reached")}</Badge>
                    ) : null}
                  </td>
                  <td className="py-2 text-end">{limitLink?.(limit) ?? null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </FormSection>
      </div>
    </div>
  );
}
