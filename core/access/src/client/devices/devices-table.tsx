import { DEFAULT_TIME_ZONE, LOCALE } from "@mustawfi/i18n";
import { Badge, type DataColumn, DataTable } from "@mustawfi/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";

const INSTANT = new Intl.DateTimeFormat(`${LOCALE}-u-nu-latn`, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DEFAULT_TIME_ZONE,
});

/** An instant as the store reads it: its date and time in Damascus, Western digits. */
export function formatInstant(iso: string): string {
  return INSTANT.format(new Date(iso));
}

/** A device's status as a word with its colour: active, revoked, or revoked and wiped. */
export function DeviceStatus({ device }: { readonly device: DeviceView }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  if (device.status === "active") return <Badge tone="positive">{t("devices.state.active")}</Badge>;
  return device.wipedAt === null ? (
    <Badge tone="warning">{t("devices.state.revoked")}</Badge>
  ) : (
    <Badge tone="neutral">{t("devices.state.wiped")}</Badge>
  );
}

export interface DevicesTableProps {
  readonly devices: readonly DeviceView[];
  /** The device this client is, marked in the list. */
  readonly currentDeviceId: string | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly tableRef?: Ref<HTMLTableElement>;
}

/** The devices list: name, type, prefix, last sync, and the status as a word. */
export function DevicesTable({
  devices,
  currentDeviceId,
  selectedId,
  onSelect,
  tableRef,
}: DevicesTableProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const columns: DataColumn<DeviceView>[] = [
    {
      id: "name",
      header: t("devices.column.name"),
      isRowHeader: true,
      cell: (row) => (
        <span className="flex items-center gap-2">
          {row.name}
          {row.id === currentDeviceId ? <Badge tone="info">{t("devices.thisDevice")}</Badge> : null}
        </span>
      ),
    },
    { id: "type", header: t("devices.column.type"), cell: (row) => t(`device.types.${row.type}`) },
    {
      id: "prefix",
      header: t("devices.column.prefix"),
      cell: (row) => (
        <bdi dir="ltr" className="font-mono">
          {row.prefix}
        </bdi>
      ),
    },
    {
      id: "lastSync",
      header: t("devices.column.lastSync"),
      cell: (row) =>
        row.lastSyncAt === null ? (
          <span className="text-text-secondary">{t("devices.neverSynced")}</span>
        ) : (
          formatInstant(row.lastSyncAt)
        ),
    },
    {
      id: "status",
      header: t("devices.column.status"),
      cell: (row) => <DeviceStatus device={row} />,
    },
  ];
  return (
    <DataTable
      label={t("devices.table")}
      columns={columns}
      rows={devices}
      rowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={t("devices.empty")}
      {...(tableRef === undefined ? {} : { tableRef })}
    />
  );
}
