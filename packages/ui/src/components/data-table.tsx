import type { ReactNode } from "react";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { cx, FOCUS_RING } from "./cx.ts";
import { UI_NAMESPACE } from "./messages.ts";

export interface DataColumn<T> {
  readonly id: string;
  readonly header: ReactNode;
  /** `end` for figures: numeric columns align to the end with tabular digits. */
  readonly align?: "start" | "end";
  /** The column that names a row for assistive tech; the first column by default. */
  readonly isRowHeader?: boolean;
  readonly cell: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  /** The table's accessible name. */
  readonly label: string;
  readonly columns: readonly DataColumn<T>[];
  readonly rows: readonly T[];
  readonly rowId: (row: T) => string;
  readonly emptyState?: ReactNode;
}

/**
 * A data grid on React Aria's table: arrow keys move between rows and cells, and alternate
 * rows use the ledger `row-alt-bg`. Not virtualized yet; no totals row or entry mode yet.
 */
export function DataTable<T>({ label, columns, rows, rowId, emptyState }: DataTableProps<T>) {
  const { t } = useTranslation(UI_NAMESPACE);
  const hasRowHeader = columns.some((column) => column.isRowHeader === true);
  const items = rows.map((row) => ({ id: rowId(row), row }));
  const alignment = (column: DataColumn<T>) =>
    column.align === "end" ? "text-end tabular-nums" : "text-start";
  return (
    <Table aria-label={label} className="w-full border-collapse bg-surface text-density text-text">
      <TableHeader columns={columns}>
        {(column) => (
          <Column
            id={column.id}
            isRowHeader={column.isRowHeader ?? (!hasRowHeader && column === columns[0])}
            className={cx(
              "h-row border-b border-field-border px-pad-inline text-sm font-semibold text-text-secondary",
              alignment(column),
              FOCUS_RING,
            )}
          >
            {column.header}
          </Column>
        )}
      </TableHeader>
      <TableBody
        items={items}
        renderEmptyState={() => (
          <p className="px-pad-inline py-pad-block text-text-muted">
            {emptyState ?? t("dataTable.empty")}
          </p>
        )}
      >
        {(item) => (
          <Row
            id={item.id}
            columns={columns}
            className={cx(
              "h-row even:bg-row-alt-bg data-[selected]:bg-row-selected-bg",
              FOCUS_RING,
            )}
          >
            {(column) => (
              <Cell
                className={cx(
                  "border-b border-divider px-pad-inline",
                  alignment(column),
                  FOCUS_RING,
                )}
              >
                {column.cell(item.row)}
              </Cell>
            )}
          </Row>
        )}
      </TableBody>
    </Table>
  );
}
