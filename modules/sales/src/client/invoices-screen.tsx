import { apiRequest } from "@mustawfi/core-config/client";
import { priceCurrency } from "@mustawfi/inventory/client";
import { LOCALE } from "@mustawfi/i18n";
import { Decimal, Money as KernelMoney } from "@mustawfi/kernel";
import { Button, type DataColumn, DataTable, Money } from "@mustawfi/ui";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type InvoiceView, invoiceListSchema } from "../shared/index.ts";
import { SALES_NAMESPACE } from "./messages.ts";

type JournalLine = NonNullable<InvoiceView["journalEntry"]>["lines"][number] & {
  /** Position in the entry: an account can appear on more than one line. */
  readonly position: number;
};

export const serverInvoicesQueryKey = ["sales", "invoices"] as const;

/** The newest invoices the server recorded, with their entries (online: owner reports). */
export function serverInvoicesQueryOptions() {
  return queryOptions({
    queryKey: serverInvoicesQueryKey,
    queryFn: async ({ signal }) =>
      (await apiRequest("/api/v1/sales/invoices", { schema: invoiceListSchema, signal })).items,
  });
}

function SideAmount(props: { readonly amount: string; readonly currency: string }) {
  if (Decimal.of(props.amount).isZero()) return null;
  return <Money value={KernelMoney.of(props.amount, priceCurrency(props.currency))} />;
}

function InvoiceCard({ invoice }: { readonly invoice: InvoiceView }) {
  const { t } = useTranslation(SALES_NAMESPACE);
  const titleId = `invoice-${invoice.id}`;
  const entry = invoice.journalEntry;
  const columns: DataColumn<JournalLine>[] = [
    {
      id: "account",
      header: t("invoices.entry.account"),
      isRowHeader: true,
      cell: (line) => (
        <span className="flex gap-2">
          <bdi dir="ltr" className="font-mono">
            {line.accountCode}
          </bdi>
          <span>{line.accountName}</span>
        </span>
      ),
    },
    {
      id: "debit",
      header: t("invoices.entry.debit"),
      align: "end",
      cell: (line) => <SideAmount amount={line.debit} currency={entry?.currency ?? ""} />,
    },
    {
      id: "credit",
      header: t("invoices.entry.credit"),
      align: "end",
      cell: (line) => <SideAmount amount={line.credit} currency={entry?.currency ?? ""} />,
    },
  ];
  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-density-gap rounded-md bg-surface p-4"
    >
      <h2 id={titleId} className="text-lg font-semibold text-text">
        <bdi dir="ltr" className="font-mono">
          {invoice.number}
        </bdi>
      </h2>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <div>
          <dt className="text-sm text-text-secondary">{t("invoices.date")}</dt>
          <dd className="text-text">
            <bdi dir="ltr">{invoice.businessDate}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-text-secondary">{t("invoices.total")}</dt>
          <dd className="text-text">
            <Money
              value={KernelMoney.of(invoice.total.amount, priceCurrency(invoice.total.currency))}
            />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-text-secondary">{t("invoices.flags.label")}</dt>
          <dd className="text-text">
            {invoice.flags.length === 0
              ? t("invoices.flags.none")
              : new Intl.ListFormat(LOCALE).format(
                  invoice.flags.map((flag) => t(`invoices.flags.${flag}`)),
                )}
          </dd>
        </div>
      </dl>
      <h3 className="font-semibold text-text">{t("invoices.entry.title")}</h3>
      {entry === null ? (
        <p className="text-text-secondary">{t("invoices.entry.none")}</p>
      ) : (
        <DataTable
          label={`${t("invoices.entry.title")} ${invoice.number}`}
          columns={columns}
          rows={entry.lines.map((line, index) => ({ ...line, position: index + 1 }))}
          rowId={(line) => String(line.position)}
        />
      )}
    </article>
  );
}

/** What the server recorded (flow 7): each synced sale and the balanced entry it posted. */
export function InvoicesScreen() {
  const { t } = useTranslation(SALES_NAMESPACE);
  const invoices = useQuery(serverInvoicesQueryOptions());
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold text-text">{t("invoices.title")}</h1>
      {invoices.isError ? (
        <div role="alert" className="flex items-center gap-3 text-text-negative">
          <span>{t("invoices.loadFailed")}</span>
          <Button
            variant="secondary"
            onPress={() => {
              void invoices.refetch();
            }}
          >
            {t("invoices.retry")}
          </Button>
        </div>
      ) : invoices.data === undefined ? (
        <p className="text-text-secondary">{t("invoices.loading")}</p>
      ) : invoices.data.length === 0 ? (
        <p className="text-text-secondary">{t("invoices.empty")}</p>
      ) : (
        invoices.data.map((invoice) => <InvoiceCard key={invoice.id} invoice={invoice} />)
      )}
    </div>
  );
}
