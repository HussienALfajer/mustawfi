import {
  Button,
  focusDataTableRow,
  Kbd,
  SearchField,
  SegmentedControl,
  Select,
  useShortcut,
} from "@mustawfi/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { UserView } from "../../shared/index.ts";
import { ListLoadFailure } from "../list-load-failure.tsx";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { rolesQueryOptions } from "../roles/queries.ts";
import { sessionQueryOptions } from "../session.ts";
import { usersQueryOptions } from "./queries.ts";
import { type DepartmentOption, UserPanel } from "./user-form.tsx";
import { UsersTable } from "./users-table.tsx";

/** The «all» choice of the role and department filters. */
const ALL = "all";

/** What the users list shows, kept in the URL so a filtered list can be reopened. */
export const userFiltersSchema = z.object({
  status: z.enum(["active", "deactivated", "all"]).catch("active").default("active"),
  q: z.string().catch("").default(""),
  /** Only users holding this role. */
  role: z.string().optional().catch(undefined),
  /** Only users who work in this department (every-department users included). */
  department: z.string().optional().catch(undefined),
  /** The user open in the side panel, or `new`. */
  selected: z.string().optional().catch(undefined),
});

export type UserFilters = z.infer<typeof userFiltersSchema>;

/** The users a filter shows, in their order; the search matches the name or the login. */
export function filterUsers(
  users: readonly UserView[],
  filters: Pick<UserFilters, "status" | "q" | "role" | "department">,
): UserView[] {
  const query = filters.q.trim().toLocaleLowerCase("ar");
  return users.filter(
    (user) =>
      (filters.status === "all" || user.status === filters.status) &&
      (filters.role === undefined || user.role.id === filters.role) &&
      (filters.department === undefined ||
        user.departmentScope === "all" ||
        user.departments.includes(filters.department)) &&
      (query === "" ||
        user.name.toLocaleLowerCase("ar").includes(query) ||
        (user.login ?? "").includes(query)),
  );
}

export interface UsersScreenProps {
  readonly filters: UserFilters;
  /** Replaces the filters (in the URL); unchanged keys are passed through. */
  readonly onFiltersChange: (next: UserFilters) => void;
  /**
   * The store's departments, archived ones included, from `core.organization` (composed by
   * the app); `undefined` while they load.
   */
  readonly departments: readonly DepartmentOption[] | undefined;
}

/**
 * Users (list with side panel), online only. Viewing needs `access.users.view`; adding and
 * changing, `access.users.manage`. While the store has one active department, no department
 * column, filter, or picker shows (rule 29).
 */
export function UsersScreen({ filters, onFiltersChange, departments }: UsersScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const users = useQuery(usersQueryOptions());
  const roles = useQuery(rolesQueryOptions());
  const session = useQuery(sessionQueryOptions()).data;
  const viewer = {
    id: session?.user.id ?? "",
    isOwner: session?.user.role.isOwner === true,
    canManage: session?.user.permissions.includes("access.users.manage") === true,
  };
  const tableRef = useRef<HTMLTableElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  // A user added in the open panel keeps that panel (and its notice) once it has an id.
  const [added, setAdded] = useState<string | undefined>();
  const select = (selected: string | undefined) => {
    setAdded(undefined);
    onFiltersChange({ ...filters, selected });
  };
  useShortcut({ key: "n" }, () => {
    if (viewer.canManage) select("new");
  });

  const allDepartments = departments ?? [];
  const showDepartments =
    allDepartments.filter((department) => department.archivedAt === null).length > 1;
  const visible = filterUsers(users.data ?? [], {
    ...filters,
    department: showDepartments ? filters.department : undefined,
  });
  const selected =
    filters.selected === "new" ? null : users.data?.find((user) => user.id === filters.selected);
  const closePanel = () => {
    const closing = filters.selected;
    select(undefined);
    if (closing === undefined || closing === "new") newButtonRef.current?.focus();
    else focusDataTableRow(tableRef.current, closing);
  };
  const failed = users.isError ? users.error : roles.isError ? roles.error : null;
  const roleOptions = [
    { id: ALL, label: t("users.filter.allRoles") },
    ...(roles.data ?? []).map((role) => ({ id: role.id, label: role.name })),
  ];
  const departmentOptions = [
    { id: ALL, label: t("users.filter.allDepartments") },
    ...allDepartments
      .filter((department) => department.archivedAt === null)
      .map((department) => ({ id: department.id, label: department.name })),
  ];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-4" data-density="compact">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            label={t("users.search")}
            value={filters.q}
            onChange={(q) => {
              onFiltersChange({ ...filters, q });
            }}
          />
          <SegmentedControl
            label={t("users.status")}
            value={filters.status}
            onChange={(status) => {
              onFiltersChange({ ...filters, status });
            }}
            options={[
              { id: "active", label: t("users.filter.active") },
              { id: "deactivated", label: t("users.filter.deactivated") },
              { id: "all", label: t("users.filter.all") },
            ]}
          />
          <Select
            className="w-44"
            labelHidden
            label={t("users.filter.role")}
            options={roleOptions}
            value={filters.role ?? ALL}
            onChange={(role) => {
              onFiltersChange({ ...filters, role: role === ALL ? undefined : role });
            }}
          />
          {showDepartments ? (
            <Select
              className="w-44"
              labelHidden
              label={t("users.filter.department")}
              options={departmentOptions}
              value={filters.department ?? ALL}
              onChange={(department) => {
                onFiltersChange({
                  ...filters,
                  department: department === ALL ? undefined : department,
                });
              }}
            />
          ) : null}
          {users.data === undefined ? null : (
            <span className="text-sm whitespace-nowrap text-text-secondary">
              {t("users.count", { count: visible.length })}
            </span>
          )}
          {viewer.canManage ? (
            <div className="ms-auto" data-density="comfortable">
              <Button
                ref={newButtonRef}
                aria-keyshortcuts="N"
                onPress={() => {
                  select("new");
                }}
              >
                <Plus aria-hidden="true" size={16} strokeWidth={2} />
                {t("users.new")}
                <Kbd shortcut="N" />
              </Button>
            </div>
          ) : null}
        </div>
        {failed !== null ? (
          <ListLoadFailure
            screen="users"
            error={failed}
            onRetry={() => {
              void users.refetch();
              void roles.refetch();
            }}
          />
        ) : users.data === undefined ? (
          <p className="text-text-secondary">{t("users.loading")}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto border border-divider bg-surface">
            <UsersTable
              users={visible}
              departments={allDepartments}
              showDepartments={showDepartments}
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
      roles.data === undefined ||
      departments === undefined ||
      (selected === null && !viewer.canManage) ? null : (
        <UserPanel
          // A new panel for each user: its form starts from that user.
          key={selected === null || selected.id === added ? "new" : selected.id}
          user={selected}
          roles={roles.data}
          departments={departments}
          showDepartments={showDepartments}
          viewer={viewer}
          onClose={closePanel}
          onSaved={(saved) => {
            if (filters.selected !== "new") return;
            setAdded(saved.id);
            // The new user shows in the list whatever the filter was.
            onFiltersChange({ status: "active", q: "", selected: saved.id });
          }}
        />
      )}
    </div>
  );
}
