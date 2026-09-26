import type { LicenseRestriction } from "@mustawfi/core-tenancy/client";
import type { LicenseStanding } from "@mustawfi/core-tenancy/shared";
import { Button, cx } from "@mustawfi/ui";
import { Ban, Clock3, Lock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import { formatDate } from "./format.ts";

/**
 * What a client knows of its store's license: its standing (the state with its dates) and why it
 * may create no document now. A registered device takes both from its own evaluation (rules
 * 6–11); another client from the server's answer, where the restriction is the state itself.
 */
export interface LicenseNotice {
  readonly standing: LicenseStanding | null;
  readonly restriction: LicenseRestriction | null;
}

/** The notice of a client that is no registered device: the server's state, by its clock. */
export function serverLicenseNotice(standing: LicenseStanding): LicenseNotice {
  return {
    standing,
    restriction:
      standing.state === "readOnly" || standing.state === "suspended" ? standing.state : null,
  };
}

/**
 * Whether the signed-in user is turned away by a suspended license (rule 9: only owners come
 * in): on a registered device from its held day state, offline too; elsewhere from the server's.
 */
export function suspendedFor(notice: LicenseNotice | undefined, isOwner: boolean): boolean {
  return notice?.restriction === "suspended" && !isOwner;
}

const ICON_PROPS = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

export interface LicenseIndicatorProps {
  readonly notice: LicenseNotice;
  /** Owners see the expiring and grace warnings; others do not (rule 10). */
  readonly isOwner: boolean;
  /**
   * Wraps the text in a link to «License and plan» when the signed-in user may open it; the app
   * composes it, since routes are the app's.
   */
  readonly link?: (content: ReactNode) => ReactNode;
}

/**
 * The top bar's license warning (`screen-patterns.md`): a restriction explains itself to everyone
 * who reaches it; expiring and grace warn owners only (`core-foundation` rule 10). Nothing when
 * there is nothing to say.
 */
export function LicenseIndicator({ notice, isOwner, link }: LicenseIndicatorProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const { standing, restriction } = notice;
  let text: string;
  let icon: ReactNode;
  let negative = true;
  if (restriction !== null) {
    text = t(`license.notice.${restriction}`);
    icon =
      restriction === "clockBehind" ? (
        <Clock3 {...ICON_PROPS} />
      ) : restriction === "suspended" ? (
        <Ban {...ICON_PROPS} />
      ) : (
        <Lock {...ICON_PROPS} />
      );
  } else if (isOwner && standing?.state === "expiring") {
    text = t("license.notice.expiring", { date: formatDate(standing.expiresAt) });
    icon = <TriangleAlert {...ICON_PROPS} />;
    negative = false;
  } else if (isOwner && standing?.state === "grace") {
    text = t("license.notice.grace", { date: formatDate(standing.readOnlyAt) });
    icon = <TriangleAlert {...ICON_PROPS} />;
    negative = false;
  } else {
    return null;
  }
  const content = (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {text}
    </span>
  );
  return (
    <p
      data-testid="license-notice"
      className={cx("text-sm font-medium", negative ? "text-text-negative" : "text-text-warning")}
    >
      {link === undefined ? content : link(content)}
    </p>
  );
}

/** The date a restriction's sentence names, when it names one. */
function restrictionDate(restriction: LicenseRestriction, standing: LicenseStanding | null) {
  if (standing === null) return "";
  if (restriction === "readOnly") return formatDate(standing.readOnlyAt);
  if (restriction === "suspended") return formatDate(standing.suspendedAt);
  return "";
}

export interface LicenseRestrictionMessageProps {
  readonly notice: LicenseNotice & { readonly restriction: LicenseRestriction };
  readonly className?: string;
}

/**
 * Why no new document can be made on this device (rule 9), where one would be made — the POS:
 * what happened, since when, and what brings selling back.
 */
export function LicenseRestrictionMessage({ notice, className }: LicenseRestrictionMessageProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const { restriction, standing } = notice;
  return (
    <div
      data-testid="license-restriction"
      className={cx(
        "flex flex-col gap-1 rounded-sm bg-negative-tint px-pad-inline py-pad-block text-text-negative",
        className,
      )}
    >
      <p className="font-semibold">{t("license.restriction.title")}</p>
      <p>
        {t(`license.restriction.${restriction}`, {
          date: restrictionDate(restriction, standing),
        })}
      </p>
      {restriction === "readOnly" || restriction === "suspended" ? (
        <p>{t("license.restriction.renew")}</p>
      ) : null}
    </div>
  );
}

export interface StoreSuspendedScreenProps {
  /** The standing, when the client knows it (a device does; a refused session may not). */
  readonly standing?: LicenseStanding | null | undefined;
  /** The one thing to do: sign out, so an owner can sign in. */
  readonly onSignOut: () => void;
  readonly signingOut?: boolean;
}

/**
 * «Store suspended» (notice pattern): what a non-owner reaches instead of the app while the
 * license is suspended (`core-foundation` rule 9: only owners sign in).
 */
export function StoreSuspendedScreen({
  standing,
  onSignOut,
  signingOut,
}: StoreSuspendedScreenProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      <section
        aria-labelledby="store-suspended-title"
        className="flex max-w-md flex-col gap-4 rounded-md border border-divider bg-surface p-6"
      >
        <Ban aria-hidden="true" size={32} strokeWidth={1.75} className="text-text-negative" />
        <h1 id="store-suspended-title" className="text-xl font-bold text-text">
          {t("license.suspended.title")}
        </h1>
        <p className="text-text">
          {standing === null || standing === undefined
            ? t("license.suspended.body")
            : t("license.suspended.since", { date: formatDate(standing.suspendedAt) })}
        </p>
        <p className="text-text-secondary">{t("license.suspended.next")}</p>
        <div>
          <Button autoFocus isPending={signingOut === true} onPress={onSignOut}>
            {t("license.suspended.signOut")}
          </Button>
        </div>
      </section>
    </main>
  );
}
