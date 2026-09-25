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
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { RoleView } from "../../shared/index.ts";
import { ListLoadFailure } from "../list-load-failure.tsx";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { sessionQueryOptions } from "../session.ts";
import { catalogueQueryOptions, rolesQueryOptions } from "./queries.ts";
import { RolePanel } from "./role-form.tsx";
import { RolesTable } from "./roles-table.tsx";

/** What the roles list shows, kept in the URL so a filtered list can be reopened. */
export const roleFiltersSchema = z.object({
  status: z.enum(["active", "archived", "all"]).catch("active").default("active"),
  q: z.string().catch("").default(""),
  /** The role open in the side panel, or `new`. */
  selected: z.string().optional().catch(undefined),
  /** With `selected=new`: the role the new one copies. */
  from: z.string().optional().catch(undefined),
});

export type RoleFilters = z.infer<typeof roleFiltersSchema>;

/** The roles a filter shows, in their order; the search ignores case and spaces around. */
export function filterRoles(
  roles: readonly RoleView[],
  filters: Pick<RoleFilters, "status" | "q">,
): RoleView[] {
  const query = filters.q.trim().toLocaleLowerCase("ar");
  return roles.filter(
    (role) =>
      (filters.status === "all" || (filters.status === "active") === (role.archivedAt === null)) &&
      (query === "" || role.name.toLocaleLowerCase("ar").includes(query)),
  );
}

export interface RolesScreenProps {
  readonly filters: RoleFilters;
  /** Replaces the filters (in the URL); unchanged keys are passed through. */
  readonly onFiltersChange: (next: RoleFilters) => void;
}

/**
 * Roles and permissions (list with side panel), online only: the owner role, the roles seeded
 * from templates, and custom copies. Viewing needs `access.users.view`; changing,
 * `access.roles.manage`.
 */
export function RolesScreen({ filters, onFiltersChange }: RolesScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const roles = useQuery(rolesQueryOptions());
  const catalogue = useQuery(catalogueQueryOptions());
  const session = useQuery(sessionQueryOptions()).data;
  const canManage = session?.user.permissions.includes("access.roles.manage") === true;
  const tableRef = useRef<HTMLTableElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  // A role added in the open panel keeps that panel (and its notice) once it has an id.
  const [added, setAdded] = useState<{ readonly id: string; readonly key: string } | undefined>();
  const select = (selected: string | undefined, from?: string) => {
    setAdded(undefined);
    onFiltersChange({
      status: filters.status,
      q: filters.q,
      selected,
      ...(from === undefined ? {} : { from }),
    });
  };
  useShortcut({ key: "n" }, () => {
    if (canManage) select("new");
  });

  const visible = filterRoles(roles.data ?? [], filters);
  const selected =
    filters.selected === "new" ? null : roles.data?.find((role) => role.id === filters.selected);
  const source =
    filters.selected === "new" && filters.from !== undefined
      ? roles.data?.find((role) => role.id === filters.from)
      : undefined;
  const closePanel = () => {
    const closing = filters.selected;
    select(undefined);
    if (closing === undefined || closing === "new") newButtonRef.current?.focus();
    else focusDataTableRow(tableRef.current, closing);
  };
  const failed = roles.isError ? roles.error : catalogue.isError ? catalogue.error : null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4" data-density="compact">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            label={t("roles.search")}
            value={filters.q}
            onChange={(q) => {
              onFiltersChange({ ...filters, q });
            }}
          />
          <SegmentedControl
            label={t("roles.status")}
            value={filters.status}
            onChange={(status) => {
              onFiltersChange({ ...filters, status });
            }}
            options={[
              { id: "active", label: t("roles.filter.active") },
              { id: "archived", label: t("roles.filter.archived") },
              { id: "all", label: t("roles.filter.all") },
            ]}
          />
          {roles.data === undefined ? null : (
            <span className="text-sm whitespace-nowrap text-text-secondary">
              {t("roles.count", { count: visible.length })}
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
                {t("roles.new")}
                <Kbd shortcut="N" />
              </Button>
            </div>
          ) : null}
        </div>
        {failed !== null ? (
          <ListLoadFailure
            screen="roles"
            error={failed}
            onRetry={() => {
              void roles.refetch();
              void catalogue.refetch();
            }}
          />
        ) : roles.data === undefined ? (
          <p className="text-text-secondary">{t("roles.loading")}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto border border-divider bg-surface">
            <RolesTable
              roles={visible}
              selectedId={filters.selected ?? null}
              onSelect={(id) => {
                select(id ?? undefined);
              }}
              tableRef={tableRef}
            />
          </div>
        )}
      </div>
      {filters.selected === undefined ||
      selected === undefined ||
      catalogue.data === undefined ||
      (selected === null && !canManage) ? null : (
        <RolePanel
          // A new panel for each role, and for each copy: its form starts from that role.
          key={
            selected === null
              ? `new:${filters.from ?? ""}`
              : selected.id === added?.id
                ? added.key
                : selected.id
          }
          role={selected}
          source={source}
          catalogue={catalogue.data}
          canManage={canManage}
          onClose={closePanel}
          onCopy={(role) => {
            select("new", role.id);
          }}
          onSaved={(saved) => {
            if (filters.selected !== "new") return;
            setAdded({ id: saved.id, key: `new:${filters.from ?? ""}` });
            // The new role shows in the list whatever the filter was.
            onFiltersChange({
              status: filters.status === "archived" ? "all" : filters.status,
              q: "",
              selected: saved.id,
            });
          }}
        />
      )}
    </div>
  );
}
