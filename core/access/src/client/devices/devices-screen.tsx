import {
  Button,
  focusDataTableRow,
  Kbd,
  SearchField,
  SegmentedControl,
  useShortcut,
} from "@mustawfi/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { DeviceView } from "../../shared/index.ts";
import { ListLoadFailure } from "../list-load-failure.tsx";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { sessionQueryOptions } from "../session.ts";
import { DevicePanel, NewDevicePanel } from "./device-panel.tsx";
import { DevicesTable } from "./devices-table.tsx";
import { devicesQueryOptions } from "./queries.ts";

/** What the devices list shows, kept in the URL so a filtered list can be reopened. */
export const deviceFiltersSchema = z.object({
  status: z.enum(["active", "revoked", "all"]).catch("active").default("active"),
  q: z.string().catch("").default(""),
  /** The device open in the side panel, or `new` to issue a registration code. */
  selected: z.string().optional().catch(undefined),
});

export type DeviceFilters = z.infer<typeof deviceFiltersSchema>;

/** The devices a filter shows, in registration order; the search matches the name or prefix. */
export function filterDevices(
  devices: readonly DeviceView[],
  filters: Pick<DeviceFilters, "status" | "q">,
): DeviceView[] {
  const query = filters.q.trim().toLocaleLowerCase("ar");
  return devices.filter(
    (device) =>
      (filters.status === "all" || device.status === filters.status) &&
      (query === "" ||
        device.name.toLocaleLowerCase("ar").includes(query) ||
        device.prefix.toLocaleLowerCase("ar") === query),
  );
}

export interface DevicesScreenProps {
  readonly filters: DeviceFilters;
  /** Replaces the filters (in the URL); unchanged keys are passed through. */
  readonly onFiltersChange: (next: DeviceFilters) => void;
  /** The device this client is registered as, marked in the list; null when it is not one. */
  readonly currentDeviceId: string | null;
  /**
   * Once a device is revoked: the app starts a sync round when it is this one, so it sends what
   * it holds and wipes at once.
   */
  readonly onRevoked?: (device: DeviceView) => void;
}

/**
 * Devices (flow 9, list with side panel), online only, for holders of `access.devices.manage`:
 * each device's type, prefix, last sync, and status; «New» (`N`) issues a registration code;
 * a device's panel revokes it with a reason.
 */
export function DevicesScreen({
  filters,
  onFiltersChange,
  currentDeviceId,
  onRevoked,
}: DevicesScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const devices = useQuery(devicesQueryOptions());
  // Reached by its URL without the permission, the screen offers nothing the role cannot do.
  const canManage =
    useQuery(sessionQueryOptions()).data?.user.permissions.includes("access.devices.manage") ===
    true;
  const tableRef = useRef<HTMLTableElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const select = (selected: string | undefined) => {
    onFiltersChange({ ...filters, selected });
  };
  useShortcut({ key: "n" }, () => {
    if (canManage) select("new");
  });

  const visible = filterDevices(devices.data ?? [], filters);
  const selected =
    filters.selected === "new" ? null : devices.data?.find((d) => d.id === filters.selected);
  const closePanel = () => {
    const closing = filters.selected;
    select(undefined);
    if (closing === undefined || closing === "new") newButtonRef.current?.focus();
    else focusDataTableRow(tableRef.current, closing);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4" data-density="compact">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            label={t("devices.search")}
            value={filters.q}
            onChange={(q) => {
              onFiltersChange({ ...filters, q });
            }}
          />
          <SegmentedControl
            label={t("devices.status")}
            value={filters.status}
            onChange={(status) => {
              onFiltersChange({ ...filters, status });
            }}
            options={[
              { id: "active", label: t("devices.filter.active") },
              { id: "revoked", label: t("devices.filter.revoked") },
              { id: "all", label: t("devices.filter.all") },
            ]}
          />
          {devices.data === undefined ? null : (
            <span className="text-sm whitespace-nowrap text-text-secondary">
              {t("devices.count", { count: visible.length })}
            </span>
          )}
          {canManage ? (
            <div className="ms-auto" data-density="comfortable">
              <Button
                ref={newButtonRef}
                aria-keyshortcuts="N"
                onPress={() => {
                  select("new");
                }}
              >
                <Plus aria-hidden="true" size={16} strokeWidth={2} />
                {t("devices.new")}
                <Kbd shortcut="N" />
              </Button>
            </div>
          ) : null}
        </div>
        {devices.isError ? (
          <ListLoadFailure
            screen="devices"
            error={devices.error}
            onRetry={() => {
              void devices.refetch();
            }}
          />
        ) : devices.data === undefined ? (
          <p className="text-text-secondary">{t("devices.loading")}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto border border-divider bg-surface">
            <DevicesTable
              devices={visible}
              currentDeviceId={currentDeviceId}
              selectedId={filters.selected ?? null}
              onSelect={(id) => {
                select(id ?? undefined);
              }}
              tableRef={tableRef}
            />
          </div>
        )}
      </div>
      {filters.selected === undefined || selected === undefined ? null : selected === null ? (
        canManage ? (
          <NewDevicePanel onClose={closePanel} />
        ) : null
      ) : (
        <DevicePanel
          // A new panel for each device: its dialog and notice start afresh.
          key={selected.id}
          device={selected}
          isCurrent={selected.id === currentDeviceId}
          onClose={closePanel}
          {...(onRevoked === undefined ? {} : { onRevoked })}
        />
      )}
    </div>
  );
}
