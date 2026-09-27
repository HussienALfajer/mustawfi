import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { DEFAULT_TIME_ZONE, LOCALE } from "@mustawfi/i18n";
import {
  Button,
  type DataColumn,
  DataTable,
  DateRangePicker,
  focusDataTableRow,
  Select,
  SidePanel,
} from "@mustawfi/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type ReactNode, type Ref, useRef } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { auditActionSchema, type AuditEntryView, type AuditFacets } from "../../shared/index.ts";
import {
  auditEntityLabelKey,
  auditFieldLabelKey,
  auditLabelKey,
  auditVariantLabelKey,
} from "../labels.ts";
import { AUDIT_NAMESPACE } from "../messages.ts";
import {
  auditEntriesQueryOptions,
  auditEntryQueryOptions,
  auditFacetsQueryOptions,
} from "./queries.ts";

const uuidSchema = z.uuid();

/** What the audit log shows, kept in the URL so a filtered log can be reopened (flow 10). */
export const auditLogFiltersSchema = z.object({
  user: z.uuid().optional().catch(undefined),
  action: auditActionSchema.optional().catch(undefined),
  device: z.uuid().optional().catch(undefined),
  /** One record's history, opened from the last line of its details panel. */
  entity: z.uuid().optional().catch(undefined),
  /** Business dates, both included. */
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  /** The entry open in the side panel. */
  selected: z.string().optional().catch(undefined),
});

export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema>;

const INSTANT = new Intl.DateTimeFormat(`${LOCALE}-u-nu-latn`, {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: DEFAULT_TIME_ZONE,
});

/** An instant as the store reads it, to the second: date and time in Damascus, Western digits. */
export function formatAuditInstant(iso: string): string {
  return INSTANT.format(new Date(iso));
}

/**
 * An action's Arabic label (rule 34), or the code itself when this client has no label. Given
 * the entry's `after`, an action recorded with a reason gets that reason's own label (slice 20:
 * each way a session ends reads differently).
 */
export function useActionLabel(): (
  action: string,
  after?: Readonly<Record<string, unknown>> | null,
) => string {
  const { t, i18n } = useTranslation(AUDIT_NAMESPACE);
  return (action, after) => {
    const variant = auditVariantLabelKey(action, after);
    if (variant !== undefined && i18n.exists(variant.key, { ns: variant.ns })) {
      return t(variant.key, { ns: variant.ns });
    }
    const { ns, key } = auditLabelKey(action);
    return i18n.exists(key, { ns }) ? t(key, { ns }) : t("log.unknownAction", { action });
  };
}

/** How a snapshot's words are found: the writing module's labels, with the log's own as fallback. */
export interface AuditWords {
  /** A field's name, or `undefined` when the writing module names none. */
  readonly field: (field: string) => string | undefined;
  /** A coded value's words (`dither` → «صورة»), or `undefined`. */
  readonly coded: (field: string, value: string) => string | undefined;
  readonly yes: string;
  readonly no: string;
  /** An image by its type (`PNG`) and size in kilobytes, as digits. */
  readonly image: (type: string, kilobytes: string) => string;
  /** Several values as one text, in the reader's language. */
  readonly list: (items: readonly string[]) => string;
  /** A record by its name and code (an account: «الصندوق (1100)»). */
  readonly named: (name: string, code: string) => string;
  /** One field of a nested value with its value. */
  readonly pair: (field: string, value: string) => string;
}

const KILOBYTES = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const INSTANT_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A value from a before or after snapshot, in words (`core-foundation` QA slice 26): a coded
 * value as its module names it, an instant as the store reads it, a date as `dd/mm/yyyy`, yes
 * or no, a list joined, an image by its type and size, an amount with its currency, a record
 * by its name. `undefined` and `null` (nothing recorded) are `undefined`.
 */
export function formatAuditValue(
  value: unknown,
  field: string,
  words: AuditWords,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") {
    return words.coded(field, String(value)) ?? (value ? words.yes : words.no);
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const coded = words.coded(field, value);
    if (coded !== undefined) return coded;
    if (INSTANT_TEXT.test(value)) return formatAuditInstant(value);
    const date = DATE_TEXT.exec(value);
    if (date !== null) return `${date[3] ?? ""}/${date[2] ?? ""}/${date[1] ?? ""}`;
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item: unknown) => formatAuditValue(item, field, words))
      .filter((item) => item !== undefined);
    return items.length === 0 ? undefined : words.list(items);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["sha256"] === "string" && typeof record["type"] === "string") {
      const type = record["type"].replace(/^image\//, "").toUpperCase();
      const size = typeof record["size"] === "number" ? record["size"] : 0;
      return words.image(type, KILOBYTES.format(Math.max(1, size / 1024)));
    }
    if (typeof record["amount"] === "string" && typeof record["currency"] === "string") {
      return `${record["amount"]} ${record["currency"]}`;
    }
    if (typeof record["name"] === "string") {
      return typeof record["code"] === "string"
        ? words.named(record["name"], record["code"])
        : record["name"];
    }
    const parts = Object.entries(record)
      .map(([key, item]) => {
        const text = formatAuditValue(item, key, words);
        return text === undefined ? undefined : words.pair(words.field(key) ?? key, text);
      })
      .filter((part) => part !== undefined);
    return parts.length === 0 ? undefined : words.list(parts);
  }
  return JSON.stringify(value);
}

/** The words of `action`'s snapshots: its module's field and value names, then the log's. */
export function useAuditWords(action: string): AuditWords {
  const { t, i18n } = useTranslation(AUDIT_NAMESPACE);
  const found = ({ ns, key }: { readonly ns: string; readonly key: string }) =>
    i18n.exists(key, { ns }) ? t(key, { ns }) : undefined;
  return {
    field: (field) => found(auditFieldLabelKey(action, field)),
    coded: (field, value) =>
      /^[A-Za-z0-9]+$/.test(value) ? found(auditFieldLabelKey(action, field, value)) : undefined,
    yes: t("log.value.yes"),
    no: t("log.value.no"),
    image: (type, kilobytes) => t("log.value.image", { type, kilobytes }),
    // A plain separator: Arabic list formats attach «و» to the next item, a phone number too.
    list: (items) => items.join(t("log.value.separator")),
    named: (name, code) => t("log.value.named", { name, code }),
    pair: (field, value) => t("log.value.pair", { field, value }),
  };
}

const ALL = "__all";

type ActionLabel = ReturnType<typeof useActionLabel>;

export interface AuditLogScreenProps {
  readonly filters: AuditLogFilters;
  /** Replaces the filters (in the URL); unchanged keys are passed through. */
  readonly onFiltersChange: (next: AuditLogFilters) => void;
}

/**
 * The audit log (flow 10, compact list with side panel), online only, for owners and holders of
 * `audit.view` (rule 35): newest first, filtered by user, action, device, and business dates;
 * an entry's panel shows who, where, when — the device's time and the server's — and the values
 * before and after. Nothing on it changes the log.
 */
export function AuditLogScreen({ filters, onFiltersChange }: AuditLogScreenProps) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  const actionLabel = useActionLabel();
  const rangeReversed =
    filters.from !== undefined && filters.to !== undefined && filters.from > filters.to;
  const entries = useInfiniteQuery({
    ...auditEntriesQueryOptions(filters),
    enabled: !rangeReversed,
  });
  const facets = useQuery(auditFacetsQueryOptions());
  const tableRef = useRef<HTMLTableElement>(null);

  const rows = entries.data?.pages.flatMap((page) => page.items) ?? [];
  const loaded = rows.find((entry) => entry.id === filters.selected);
  // An entry the loaded pages do not hold — opened after «تحميل المزيد», then reloaded or
  // shared — is read on its own, so the URL reopens its panel (QA slice 25).
  const selectedId = uuidSchema.safeParse(filters.selected).data;
  const lookup = useQuery({
    ...auditEntryQueryOptions(selectedId ?? ""),
    enabled: selectedId !== undefined && entries.data !== undefined && loaded === undefined,
  });
  const selected =
    loaded ??
    (lookup.data !== undefined && lookup.data.id === selectedId ? lookup.data : undefined);
  // Why the entry the URL names is not open: none of this store's, or not reachable now.
  const missing =
    filters.selected === undefined || entries.data === undefined || selected !== undefined
      ? undefined
      : selectedId === undefined ||
          (lookup.error instanceof ApiProblem && lookup.error.status === 404)
        ? "notFound"
        : lookup.isError
          ? "failed"
          : undefined;
  const closePanel = () => {
    const closing = filters.selected;
    onFiltersChange({ ...filters, selected: undefined });
    if (closing !== undefined) focusDataTableRow(tableRef.current, closing);
  };
  const filtering =
    filters.entity !== undefined ||
    filters.user !== undefined ||
    filters.action !== undefined ||
    filters.device !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4" data-density="compact">
        <AuditLogFilterBar
          filters={filters}
          facets={facets.data}
          actionLabel={actionLabel}
          onFiltersChange={onFiltersChange}
          rangeReversed={rangeReversed}
          canClear={filtering}
        />
        {filters.entity === undefined ? null : (
          <p className="text-text-secondary" data-testid="audit-entity-filter">
            {t("log.filter.entity")}
          </p>
        )}
        {missing === undefined ? null : (
          // A link to an entry that cannot open says so instead of opening nothing.
          <div role="status" className="flex flex-wrap items-center gap-3 text-text">
            <span>{t(`log.selected.${missing}`)}</span>
            <Button
              variant="quiet"
              onPress={() => {
                onFiltersChange({ ...filters, selected: undefined });
              }}
            >
              {t("log.selected.dismiss")}
            </Button>
          </div>
        )}
        {rangeReversed ? null : entries.isError ? (
          <LoadFailure
            error={entries.error}
            onRetry={() => {
              void entries.refetch();
            }}
          />
        ) : entries.data === undefined ? (
          <p className="text-text-secondary">{t("log.loading")}</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto border border-divider bg-surface">
            <AuditTable
              entries={rows}
              actionLabel={actionLabel}
              selectedId={filters.selected ?? null}
              onSelect={(id) => {
                onFiltersChange({ ...filters, selected: id ?? undefined });
              }}
              tableRef={tableRef}
            />
            <div className="flex justify-center p-3" data-density="comfortable">
              {entries.hasNextPage ? (
                <Button
                  variant="secondary"
                  isPending={entries.isFetchingNextPage}
                  onPress={() => {
                    void entries.fetchNextPage();
                  }}
                >
                  {t("log.more")}
                </Button>
              ) : rows.length === 0 ? null : (
                <span className="text-sm text-text-secondary">{t("log.end")}</span>
              )}
            </div>
          </div>
        )}
      </div>
      {selected === undefined ? null : (
        <AuditEntryPanel entry={selected} actionLabel={actionLabel} onClose={closePanel} />
      )}
    </div>
  );
}

function AuditLogFilterBar({
  filters,
  facets,
  actionLabel,
  onFiltersChange,
  rangeReversed,
  canClear,
}: {
  readonly filters: AuditLogFilters;
  readonly facets: AuditFacets | undefined;
  readonly actionLabel: ActionLabel;
  readonly onFiltersChange: (next: AuditLogFilters) => void;
  readonly rangeReversed: boolean;
  readonly canClear: boolean;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  // A filter from the URL stays offered even before the facets load or when they lack it.
  const withCurrent = (
    options: { id: string; label: string }[],
    current: string | undefined,
    label: (id: string) => string,
  ) =>
    current === undefined || options.some((option) => option.id === current)
      ? options
      : [...options, { id: current, label: label(current) }];
  const userOptions = [
    { id: ALL, label: t("log.filter.allUsers") },
    ...withCurrent(
      (facets?.users ?? []).map((user) => ({ id: user.id, label: user.name })),
      filters.user,
      (id) => id,
    ),
  ];
  const actionOptions = [
    { id: ALL, label: t("log.filter.allActions") },
    ...withCurrent(
      (facets?.actions ?? [])
        .map((action) => ({ id: action, label: actionLabel(action) }))
        .sort((a, b) => a.label.localeCompare(b.label, "ar")),
      filters.action,
      actionLabel,
    ),
  ];
  const deviceOptions = [
    { id: ALL, label: t("log.filter.allDevices") },
    ...withCurrent(
      (facets?.devices ?? []).map((device) => ({
        id: device.id,
        label: `${device.name} (${device.prefix})`,
      })),
      filters.device,
      (id) => id,
    ),
  ];
  const pick = (value: string) => (value === ALL ? undefined : value);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        className="w-44"
        labelHidden
        label={t("log.filter.user")}
        options={userOptions}
        value={filters.user ?? ALL}
        onChange={(user) => {
          onFiltersChange({ ...filters, user: pick(user), selected: undefined });
        }}
      />
      <Select
        className="w-60"
        labelHidden
        label={t("log.filter.action")}
        options={actionOptions}
        value={filters.action ?? ALL}
        onChange={(action) => {
          onFiltersChange({ ...filters, action: pick(action), selected: undefined });
        }}
      />
      <Select
        className="w-48"
        labelHidden
        label={t("log.filter.device")}
        options={deviceOptions}
        value={filters.device ?? ALL}
        onChange={(device) => {
          onFiltersChange({ ...filters, device: pick(device), selected: undefined });
        }}
      />
      <DateRangePicker
        labelHidden
        label={t("log.filter.dates")}
        value={
          filters.from === undefined || filters.to === undefined
            ? null
            : { start: filters.from, end: filters.to }
        }
        errorMessage={rangeReversed ? t("log.filter.rangeReversed") : undefined}
        onChange={(range) => {
          onFiltersChange({
            ...filters,
            from: range?.start,
            to: range?.end,
            selected: undefined,
          });
        }}
      />
      {canClear ? (
        <Button
          variant="secondary"
          onPress={() => {
            onFiltersChange({});
          }}
        >
          {t("log.filter.clear")}
        </Button>
      ) : null}
    </div>
  );
}

function LoadFailure({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  const key =
    error instanceof ApiUnreachable
      ? "offline"
      : error instanceof ApiProblem && error.status === 403
        ? "denied"
        : "loadFailed";
  return (
    <div role="alert" className="flex items-center gap-3 text-text-negative">
      <span>{t(`log.${key}`)}</span>
      {key === "denied" ? null : (
        <Button variant="secondary" onPress={onRetry}>
          {t("log.retry")}
        </Button>
      )}
    </div>
  );
}

function DeviceName({ device }: { readonly device: AuditEntryView["device"] }) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  if (device === null) return <span className="text-text-secondary">{t("log.noDevice")}</span>;
  return (
    <span>
      {device.name}{" "}
      <bdi dir="ltr" className="font-mono text-text-secondary">
        {device.prefix}
      </bdi>
    </span>
  );
}

function AuditTable({
  entries,
  actionLabel,
  selectedId,
  onSelect,
  tableRef,
}: {
  readonly entries: readonly AuditEntryView[];
  readonly actionLabel: ActionLabel;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly tableRef: Ref<HTMLTableElement>;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  const columns: DataColumn<AuditEntryView>[] = [
    {
      id: "occurredAt",
      header: t("log.column.occurredAt"),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">{formatAuditInstant(row.occurredAt)}</span>
      ),
    },
    {
      id: "recordedAt",
      header: t("log.column.recordedAt"),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">{formatAuditInstant(row.recordedAt)}</span>
      ),
    },
    {
      id: "user",
      header: t("log.column.user"),
      cell: (row) =>
        row.user === null ? (
          <span className="text-text-secondary">{t("log.noUser")}</span>
        ) : (
          row.user.name
        ),
    },
    {
      id: "action",
      header: t("log.column.action"),
      isRowHeader: true,
      cell: (row) => actionLabel(row.action, row.after),
    },
    {
      id: "device",
      header: t("log.column.device"),
      cell: (row) => <DeviceName device={row.device} />,
    },
  ];
  return (
    <DataTable
      label={t("log.table")}
      columns={columns}
      rows={entries}
      rowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={t("log.empty")}
      tableRef={tableRef}
    />
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-text">{children}</dd>
    </>
  );
}

/** An entry beside the log: who, where, when, why, and the values before and after. */
export function AuditEntryPanel({
  entry,
  actionLabel,
  onClose,
}: {
  readonly entry: AuditEntryView;
  readonly actionLabel: ActionLabel;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  const fromDevice = entry.source === "device";
  return (
    <SidePanel
      title={actionLabel(entry.action, entry.after)}
      closeLabel={t("log.panel.close")}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Fact label={fromDevice ? t("log.panel.occurredOnDevice") : t("log.panel.occurredAt")}>
            {formatAuditInstant(entry.occurredAt)}
          </Fact>
          <Fact label={t("log.panel.recordedAt")}>{formatAuditInstant(entry.recordedAt)}</Fact>
          <Fact label={t("log.panel.source")}>
            {fromDevice ? t("log.panel.sourceDevice") : t("log.panel.sourceServer")}
          </Fact>
          <Fact label={t("log.panel.user")}>{entry.user?.name ?? t("log.noUser")}</Fact>
          <Fact label={t("log.panel.device")}>
            <DeviceName device={entry.device} />
          </Fact>
          {entry.entity === null ? null : (
            <Fact label={t("log.panel.entity")}>
              <EntityName entry={entry} entity={entry.entity} />
            </Fact>
          )}
          {entry.reason === null ? null : <Fact label={t("log.panel.reason")}>{entry.reason}</Fact>}
        </dl>
        <AuditValues action={entry.action} before={entry.before} after={entry.after} />
      </div>
    </SidePanel>
  );
}

/**
 * The record an entry is about, in words: its type as its module names it and, when a snapshot
 * carries one, its name; its id stays below for tracing.
 */
function EntityName({
  entry,
  entity,
}: {
  readonly entry: AuditEntryView;
  readonly entity: NonNullable<AuditEntryView["entity"]>;
}) {
  const { t, i18n } = useTranslation(AUDIT_NAMESPACE);
  const { ns, key } = auditEntityLabelKey(entity.type);
  const type = i18n.exists(key, { ns }) ? t(key, { ns }) : entity.type;
  const name = [entry.after?.["name"], entry.before?.["name"]].find(
    (value): value is string => typeof value === "string",
  );
  return (
    <span className="flex flex-col">
      <span>{name === undefined ? type : t("log.panel.entityNamed", { type, name })}</span>
      <bdi dir="ltr" className="font-mono text-xs break-all text-text-secondary">
        {entity.id}
      </bdi>
    </span>
  );
}

/**
 * The snapshot fields, before and after, in words. An entry with both shows the changed fields
 * and folds the unchanged ones away; a changed field is marked (`data-changed`).
 */
function AuditValues({
  action,
  before,
  after,
}: {
  readonly action: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  const words = useAuditWords(action);
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (fields.length === 0) {
    return <p className="text-text-secondary">{t("log.panel.noValues")}</p>;
  }
  const same = (field: string) =>
    JSON.stringify(before?.[field] ?? null) === JSON.stringify(after?.[field] ?? null);
  const both = before !== null && after !== null;
  const changed = both ? fields.filter((field) => !same(field)) : fields;
  const unchanged = both ? fields.filter(same) : [];
  const rows = (shown: readonly string[], marked: boolean) =>
    shown.map((field) => (
      <tr
        key={field}
        className="border-b border-divider align-top"
        data-changed={marked ? "true" : undefined}
      >
        <th scope="row" className="py-1 pe-2 text-start font-normal">
          {words.field(field) ?? (
            <bdi dir="ltr" className="font-mono">
              {field}
            </bdi>
          )}
        </th>
        <ValueCell value={formatAuditValue(before?.[field], field, words)} />
        <ValueCell value={formatAuditValue(after?.[field], field, words)} strong={marked && both} />
      </tr>
    ));
  const head = (
    <thead>
      <tr className="border-b border-divider text-text-secondary">
        <th scope="col" className="py-1 pe-2 text-start font-normal">
          {t("log.panel.field")}
        </th>
        <th scope="col" className="py-1 pe-2 text-start font-normal">
          {t("log.panel.before")}
        </th>
        <th scope="col" className="py-1 text-start font-normal">
          {t("log.panel.after")}
        </th>
      </tr>
    </thead>
  );
  return (
    <div className="flex flex-col gap-3">
      {changed.length === 0 ? (
        <p className="text-text-secondary">{t("log.panel.nothingChanged")}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="mb-2 text-start font-semibold text-text">
            {t("log.panel.values")}
          </caption>
          {head}
          <tbody>{rows(changed, both)}</tbody>
        </table>
      )}
      {unchanged.length === 0 ? null : (
        <details className="text-sm">
          <summary className="cursor-pointer text-text-accent">
            {t("log.panel.unchanged", { count: unchanged.length })}
          </summary>
          <table className="mt-2 w-full border-collapse">
            <caption className="sr-only">{t("log.panel.unchangedTable")}</caption>
            {head}
            <tbody>{rows(unchanged, false)}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function ValueCell({
  value,
  strong = false,
}: {
  readonly value: string | undefined;
  readonly strong?: boolean;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  return (
    <td className={strong ? "py-1 pe-2 font-semibold" : "py-1 pe-2"}>
      {value === undefined ? (
        <span className="text-text-secondary">{t("log.panel.empty")}</span>
      ) : (
        <bdi className="break-words">{value}</bdi>
      )}
    </td>
  );
}
