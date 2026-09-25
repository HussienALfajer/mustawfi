import { Badge, type DataColumn, DataTable } from "@mustawfi/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import type { UserView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";
import type { DepartmentOption } from "./user-form.tsx";

export interface UsersTableProps {
  readonly users: readonly UserView[];
  readonly departments: readonly DepartmentOption[];
  /** The departments column shows only with more than one active department (rule 29). */
  readonly showDepartments: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly tableRef?: Ref<HTMLTableElement>;
}

/** The users list: name, login, role, departments, and the status as a word. */
export function UsersTable({
  users,
  departments,
  showDepartments,
  selectedId,
  onSelect,
  tableRef,
}: UsersTableProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const names = new Map(departments.map((department) => [department.id, department.name]));
  const columns: DataColumn<UserView>[] = [
    { id: "name", header: t("users.column.name"), isRowHeader: true, cell: (row) => row.name },
    {
      id: "login",
      header: t("users.column.login"),
      cell: (row) =>
        row.login === null ? (
          <span className="text-text-secondary">{t("users.noLogin")}</span>
        ) : (
          <bdi dir="ltr">{row.login}</bdi>
        ),
    },
    { id: "role", header: t("users.column.role"), cell: (row) => row.role.name },
    ...(showDepartments
      ? [
          {
            id: "departments",
            header: t("users.column.departments"),
            cell: (row: UserView) =>
              row.departmentScope === "all" || row.role.isOwner
                ? t("users.everyDepartment")
                : row.departments.map((id) => names.get(id) ?? id).join("، "),
          },
        ]
      : []),
    {
      id: "status",
      header: t("users.column.status"),
      cell: (row) =>
        row.status === "active" ? (
          <Badge tone="positive">{t("users.state.active")}</Badge>
        ) : (
          <Badge tone="neutral">{t("users.state.deactivated")}</Badge>
        ),
    },
  ];
  return (
    <DataTable
      label={t("users.table")}
      columns={columns}
      rows={users}
      rowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={t("users.empty")}
      {...(tableRef === undefined ? {} : { tableRef })}
    />
  );
}
