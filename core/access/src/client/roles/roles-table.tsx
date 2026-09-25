import { Badge, type DataColumn, DataTable } from "@mustawfi/ui";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import type { RoleView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { RoleKindBadge } from "./role-form.tsx";

export interface RolesTableProps {
  readonly roles: readonly RoleView[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly tableRef?: Ref<HTMLTableElement>;
}

/** The roles list: name, kind (owner, template, custom), active users, and status as a word. */
export function RolesTable({ roles, selectedId, onSelect, tableRef }: RolesTableProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const columns: DataColumn<RoleView>[] = [
    { id: "name", header: t("roles.column.name"), isRowHeader: true, cell: (row) => row.name },
    { id: "kind", header: t("roles.column.kind"), cell: (row) => <RoleKindBadge role={row} /> },
    {
      id: "users",
      header: t("roles.column.users"),
      align: "end",
      cell: (row) => <span className="tabular-nums">{row.activeUsers}</span>,
    },
    {
      id: "status",
      header: t("roles.column.status"),
      cell: (row) =>
        row.archivedAt === null ? (
          <Badge tone="positive">{t("roles.state.active")}</Badge>
        ) : (
          <Badge tone="neutral">{t("roles.state.archived")}</Badge>
        ),
    },
  ];
  return (
    <DataTable
      label={t("roles.table")}
      columns={columns}
      rows={roles}
      rowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={t("roles.empty")}
      {...(tableRef === undefined ? {} : { tableRef })}
    />
  );
}
