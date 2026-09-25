import { ApiUnreachable } from "@mustawfi/core-config/client";
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
import type { DepartmentView } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import { DepartmentPanel } from "./department-form.tsx";
import { DepartmentsTable } from "./departments-table.tsx";
import { departmentsQueryOptions } from "./queries.ts";

/** What the departments list shows, kept in the URL so a filtered list can be reopened. */
export const departmentFiltersSchema = z.object({
  status: z.enum(["active", "archived", "all"]).catch("active").default("active"),
  q: z.string().catch("").default(""),
  /** The department open in the side panel, or `new`. */
  selected: z.string().optional().catch(undefined),
});

export type DepartmentFilters = z.infer<typeof departmentFiltersSchema>;

/** The departments a filter shows, in their order; the search ignores case and spaces around. */
export function filterDepartments(
  departments: readonly DepartmentView[],
  filters: Pick<DepartmentFilters, "status" | "q">,
): DepartmentView[] {
  const query = filters.q.trim().toLocaleLowerCase("ar");
  return departments.filter(
    (department) =>
      (filters.status === "all" ||
        (filters.status === "active") === (department.archivedAt === null)) &&
      (query === "" || department.name.toLocaleLowerCase("ar").includes(query)),
  );
}

export interface DepartmentsScreenProps {
  readonly filters: DepartmentFilters;
  /** Replaces the filters (in the URL); unchanged keys are passed through. */
  readonly onFiltersChange: (next: DepartmentFilters) => void;
}

/**
 * Departments (list with side panel): always reachable under Administration, online only.
 * The arrow keys move the selection and the panel follows; `N` opens a new one; `Esc` closes
 * the panel and gives focus back to the list.
 */
export function DepartmentsScreen({ filters, onFiltersChange }: DepartmentsScreenProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const departments = useQuery(departmentsQueryOptions());
  const tableRef = useRef<HTMLTableElement>(null);
  // A department added in the open panel keeps that panel (and its notice) once it has an id.
  const [added, setAdded] = useState<string | undefined>();
  const select = (selected: string | undefined) => {
    setAdded(undefined);
    onFiltersChange({ ...filters, selected });
  };
  useShortcut({ key: "n" }, () => {
    select("new");
  });

  const visible = filterDepartments(departments.data ?? [], filters);
  const selected =
    filters.selected === "new"
      ? null
      : departments.data?.find((department) => department.id === filters.selected);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  // Focus goes back where the panel came from: its row, or the New button.
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
            label={t("departments.search")}
            value={filters.q}
            onChange={(q) => {
              onFiltersChange({ ...filters, q });
            }}
          />
          <SegmentedControl
            label={t("departments.status")}
            value={filters.status}
            onChange={(status) => {
              onFiltersChange({ ...filters, status });
            }}
            options={[
              { id: "active", label: t("departments.filter.active") },
              { id: "archived", label: t("departments.filter.archived") },
              { id: "all", label: t("departments.filter.all") },
            ]}
          />
          {departments.data === undefined ? null : (
            <span className="text-sm whitespace-nowrap text-text-secondary">
              {t("departments.count", { count: visible.length })}
            </span>
          )}
          <div className="ms-auto" data-density="comfortable">
            <Button
              ref={newButtonRef}
              aria-keyshortcuts="N"
              onPress={() => {
                select("new");
              }}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              {t("departments.new")}
              <Kbd shortcut="N" />
            </Button>
          </div>
        </div>
        {departments.isError ? (
          <div role="alert" className="flex items-center gap-3 text-text-negative">
            <span>
              {t(
                departments.error instanceof ApiUnreachable
                  ? "departments.offline"
                  : "departments.loadFailed",
              )}
            </span>
            <Button
              variant="secondary"
              onPress={() => {
                void departments.refetch();
              }}
            >
              {t("departments.retry")}
            </Button>
          </div>
        ) : departments.data === undefined ? (
          <p className="text-text-secondary">{t("departments.loading")}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto border border-divider bg-surface">
            <DepartmentsTable
              departments={visible}
              selectedId={filters.selected ?? null}
              onSelect={(id) => {
                select(id ?? undefined);
              }}
              tableRef={tableRef}
            />
          </div>
        )}
      </div>
      {filters.selected === undefined || selected === undefined ? null : (
        <DepartmentPanel
          // A new panel for each department: its form starts from that department.
          key={selected === null || selected.id === added ? "new" : selected.id}
          department={selected}
          onClose={closePanel}
          onSaved={(saved) => {
            if (filters.selected !== "new") return;
            setAdded(saved.id);
            // The new department shows in the list whatever the filter was.
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
