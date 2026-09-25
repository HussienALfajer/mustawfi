import type { ReactNode, Ref } from "react";
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
  /**
   * With `onSelect`, one row is selected at a time and the selection follows the arrow keys,
   * so a side panel beside the table follows too (`screen-patterns.md`). `Esc` clears it.
   */
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string | null) => void;
  /** The table element, for `focusDataTableRow`. */
  readonly tableRef?: Ref<HTMLTableElement>;
}

/**
 * Focuses a row of a `DataTable` without selecting it: how a closing side panel gives focus back
 * to its row (`screen-patterns.md`, focus never gets lost).
 */
export function focusDataTableRow(table: HTMLTableElement | null, id: string): void {
  const row = table?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
  row?.focus();
}

/**
 * A data grid on React Aria's table: arrow keys move between rows and cells, and alternate
 * rows use the ledger `row-alt-bg`. Not virtualized yet; no totals row or entry mode yet.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowId,
  emptyState,
  selectedId,
  onSelect,
  tableRef,
}: DataTableProps<T>) {
  const { t } = useTranslation(UI_NAMESPACE);
  const hasRowHeader = columns.some((column) => column.isRowHeader === true);
  const items = rows.map((row) => ({ id: rowId(row), row }));
  const alignment = (column: DataColumn<T>) =>
    column.align === "end" ? "text-end tabular-nums" : "text-start";
  const selection =
    onSelect === undefined
      ? {}
      : {
          selectionMode: "single" as const,
          selectionBehavior: "replace" as const,
          selectedKeys: selectedId === null || selectedId === undefined ? [] : [selectedId],
          onSelectionChange: (keys: "all" | Set<string | number>) => {
            const [key] = keys === "all" ? [] : [...keys];
            onSelect(key === undefined ? null : String(key));
          },
        };
  return (
    <Table
      ref={tableRef}
      aria-label={label}
      {...selection}
      className="w-full border-collapse bg-surface text-density text-text"
    >
      <TableHeader columns={columns}>
        {(column) => (
          <Column
            id={column.id}
            isRowHeader={column.isRowHeader ?? (!hasRowHeader && column === columns[0])}
            className={cx(
              "sticky top-0 z-[1] h-row border-b border-field-border bg-surface px-pad-inline text-sm font-semibold whitespace-nowrap text-text-secondary",
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
            data-row-id={item.id}
            columns={columns}
            className={cx(
              "h-row cursor-default even:bg-row-alt-bg data-[selected]:bg-row-selected-bg rtl:data-[selected]:shadow-[inset_-3px_0_0_var(--mf-color-accent)] ltr:data-[selected]:shadow-[inset_3px_0_0_var(--mf-color-accent)]",
              FOCUS_RING,
              "data-[focus-visible]:-outline-offset-2",
            )}
          >
            {(column) => (
              <Cell
                className={cx(
                  "border-b border-divider px-pad-inline",
                  alignment(column),
                  FOCUS_RING,
                  "data-[focus-visible]:-outline-offset-2",
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
