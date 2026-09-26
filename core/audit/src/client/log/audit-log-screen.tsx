import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { DEFAULT_TIME_ZONE, LOCALE } from "@mustawfi/i18n";
import {
  Button,
  type DataColumn,
  DataTable,
  focusDataTableRow,
  Select,
  SidePanel,
  TextInput,
} from "@mustawfi/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type ReactNode, type Ref, useRef } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { auditActionSchema, type AuditEntryView, type AuditFacets } from "../../shared/index.ts";
import { auditLabelKey } from "../labels.ts";
import { AUDIT_NAMESPACE } from "../messages.ts";
import { auditEntriesQueryOptions, auditFacetsQueryOptions } from "./queries.ts";

/** What the audit log shows, kept in the URL so a filtered log can be reopened (flow 10). */
export const auditLogFiltersSchema = z.object({
  user: z.uuid().optional().catch(undefined),
  action: auditActionSchema.optional().catch(undefined),
  device: z.uuid().optional().catch(undefined),
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

/** An action's Arabic label (rule 34), or the code itself when this client has no label. */
export function useActionLabel(): (action: string) => string {
  const { t, i18n } = useTranslation(AUDIT_NAMESPACE);
  return (action) => {
    const { ns, key } = auditLabelKey(action);
    return i18n.exists(key, { ns }) ? t(key, { ns }) : t("log.unknownAction", { action });
  };
}

/** A value from a before or after snapshot, as text: strings as they are, the rest as JSON. */
export function formatAuditValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const ALL = "__all";

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
  const selected = rows.find((entry) => entry.id === filters.selected);
  const closePanel = () => {
    const closing = filters.selected;
    onFiltersChange({ ...filters, selected: undefined });
    if (closing !== undefined) focusDataTableRow(tableRef.current, closing);
  };
  const filtering =
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
  readonly actionLabel: (action: string) => string;
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
  const date = (value: string) => (value === "" ? undefined : value);
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
      <TextInput
        className="w-40"
        type="date"
        dir="ltr"
        label={t("log.filter.from")}
        value={filters.from ?? ""}
        onChange={(from) => {
          onFiltersChange({ ...filters, from: date(from), selected: undefined });
        }}
      />
      <TextInput
        className="w-40"
        type="date"
        dir="ltr"
        label={t("log.filter.to")}
        value={filters.to ?? ""}
        errorMessage={rangeReversed ? t("log.filter.rangeReversed") : undefined}
        onChange={(to) => {
          onFiltersChange({ ...filters, to: date(to), selected: undefined });
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
  readonly actionLabel: (action: string) => string;
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
      cell: (row) => actionLabel(row.action),
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
  readonly actionLabel: (action: string) => string;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  const fromDevice = entry.source === "device";
  return (
    <SidePanel
      title={actionLabel(entry.action)}
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
              <bdi dir="ltr" className="font-mono text-sm break-all">
                {entry.entity.type} {entry.entity.id}
              </bdi>
            </Fact>
          )}
          {entry.reason === null ? null : <Fact label={t("log.panel.reason")}>{entry.reason}</Fact>}
        </dl>
        <AuditValues before={entry.before} after={entry.after} />
      </div>
    </SidePanel>
  );
}

/** The snapshot fields side by side, before and after; a changed field is marked. */
function AuditValues({
  before,
  after,
}: {
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}) {
  const { t } = useTranslation(AUDIT_NAMESPACE);
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (fields.length === 0) {
    return <p className="text-text-secondary">{t("log.panel.noValues")}</p>;
  }
  const cell = (value: string | undefined) =>
    value === undefined ? (
      <span className="text-text-secondary">{t("log.panel.empty")}</span>
    ) : (
      <bdi className="break-all">{value}</bdi>
    );
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="mb-2 text-start font-semibold text-text">{t("log.panel.values")}</caption>
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
      <tbody>
        {fields.map((field) => {
          const was = formatAuditValue(before?.[field]);
          const is = formatAuditValue(after?.[field]);
          return (
            <tr
              key={field}
              className="border-b border-divider align-top"
              data-changed={was !== is ? "true" : undefined}
            >
              <th scope="row" className="py-1 pe-2 text-start font-normal">
                <bdi dir="ltr" className="font-mono">
                  {field}
                </bdi>
              </th>
              <td className="py-1 pe-2">{cell(was)}</td>
              <td className={was !== is ? "py-1 font-semibold" : "py-1"}>{cell(is)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
