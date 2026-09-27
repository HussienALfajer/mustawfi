import { DEFAULT_TIME_ZONE, LOCALE } from "@mustawfi/i18n";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LastChange } from "../shared/index.ts";
import { AUDIT_NAMESPACE } from "./messages.ts";

/**
 * Renders a link to one record's history in the audit log, with the entry to open, around
 * `children`. The app composes it (it knows the route), and only for users who may read the log
 * (`screen-patterns.md`: «linked to the audit log for users who may read it»); without one the
 * line is plain text.
 */
export type AuditLink = (
  target: { readonly entity: string; readonly entry: string },
  children: ReactNode,
) => ReactNode;

const INSTANT = new Intl.DateTimeFormat(`${LOCALE}-u-nu-latn`, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DEFAULT_TIME_ZONE,
});

export interface LastChangeLineProps {
  /** The record the panel shows. */
  readonly entityId: string;
  /** From the list the panel belongs to; null when the log holds no change of it. */
  readonly lastChange: LastChange | null;
  readonly auditLink?: AuditLink | undefined;
}

/**
 * The line every details panel ends with (`screen-patterns.md`): «last changed by … on …», a
 * link to the record's history for readers of the audit log (`core-foundation` slice 20).
 */
export function LastChangeLine({ entityId, lastChange, auditLink }: LastChangeLineProps) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  if (lastChange === null) return null;
  const at = INSTANT.format(new Date(lastChange.at));
  const text = lastChange.bySupport
    ? t("lastChange.bySupport", { at })
    : lastChange.by === null || lastChange.by.name === ""
      ? t("lastChange.at", { at })
      : t("lastChange.by", { name: lastChange.by.name, at });
  return (
    <p className="border-t border-divider pt-3 text-sm text-text-secondary" data-last-change="">
      {auditLink === undefined
        ? text
        : auditLink({ entity: entityId, entry: lastChange.entryId }, text)}
    </p>
  );
}
