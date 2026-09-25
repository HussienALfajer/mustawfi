import { Badge, type DataColumn, DataTable } from "@mustawfi/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import type { DepartmentView } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";

export interface DepartmentsTableProps {
  readonly departments: readonly DepartmentView[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly tableRef?: Ref<HTMLTableElement>;
}

/** The departments list: name with the default mark, and the status as a word. */
export function DepartmentsTable({
  departments,
  selectedId,
  onSelect,
  tableRef,
}: DepartmentsTableProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const columns: DataColumn<DepartmentView>[] = [
    {
      id: "name",
      header: t("departments.column.name"),
      isRowHeader: true,
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          {row.name}
          {row.isDefault ? <Badge tone="info">{t("departments.default")}</Badge> : null}
        </span>
      ),
    },
    {
      id: "status",
      header: t("departments.column.status"),
      cell: (row) =>
        row.archivedAt === null ? (
          <Badge tone="positive">{t("departments.state.active")}</Badge>
        ) : (
          <Badge tone="neutral">{t("departments.state.archived")}</Badge>
        ),
    },
  ];
  return (
    <DataTable
      label={t("departments.table")}
      columns={columns}
      rows={departments}
      rowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={t("departments.empty")}
      {...(tableRef === undefined ? {} : { tableRef })}
    />
  );
}
