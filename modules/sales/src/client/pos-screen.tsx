import { type LocalDevice, localDeviceQueryOptions } from "@mustawfi/core-access/client";
import { useClientRuntime } from "@mustawfi/core-config/client";
import type { ProductView } from "@mustawfi/inventory/shared";
import {
  localProductByBarcode,
  localProductsQueryOptions,
  priceCurrency,
} from "@mustawfi/inventory/client";
import { formatDecimal, useDigitShape } from "@mustawfi/i18n";
import { Money as KernelMoney } from "@mustawfi/kernel";
import { useLocalDb } from "@mustawfi/local-db";
import { Button, type DataColumn, DataTable, Money, TextInput } from "@mustawfi/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addToCart,
  type CartLine,
  cartQueryOptions,
  completeCashSale,
  type LocalInvoice,
  localInvoicesQueryOptions,
  removeFromCart,
  SaleRefused,
} from "./local-sales.ts";
import { SALES_NAMESPACE } from "./messages.ts";

export interface PosScreenProps {
  /** The signed-in user who sells, and their store. */
  readonly seller: { readonly userId: string; readonly tenantId: string };
  /** Where to register this device when it is not registered yet. */
  readonly registerDeviceLink: ReactNode;
  /**
   * What the platform offers for a recorded invoice — its receipt (ADR-0025). The POS does
   * not print by itself: printing is the platform's, and the browser is no printing client.
   */
  readonly receiptAction?: ((invoice: RecordedInvoiceRef) => ReactNode) | undefined;
}

/** An invoice this device recorded, as the receipt action receives it. */
export interface RecordedInvoiceRef {
  readonly id: string;
  readonly number: string;
  /** The device that recorded it, as its receipt names it. */
  readonly deviceName: string;
  /** Offered with the sale just completed, not from the list of earlier invoices. */
  readonly justSold: boolean;
}

function ScanForm() {
  const { t } = useTranslation(SALES_NAMESPACE);
  const db = useLocalDb();
  const [barcode, setBarcode] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useMutation({
    mutationFn: async (code: string) => {
      const product = await localProductByBarcode(db, code);
      if (product === undefined) return false;
      await addToCart(db, product.id);
      return true;
    },
    networkMode: "always",
    onSuccess: (found) => {
      setProblem(found ? undefined : "pos.scan.notFound");
      if (found) setBarcode("");
      inputRef.current?.focus();
    },
    onError: () => {
      setProblem("pos.scan.failed");
    },
  });
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const code = barcode.trim();
        if (code !== "") add.mutate(code);
      }}
    >
      <TextInput
        label={t("pos.scan.label")}
        description={t("pos.scan.help")}
        errorMessage={problem === undefined ? undefined : t(problem)}
        value={barcode}
        onChange={setBarcode}
        inputRef={inputRef}
        dir="ltr"
        autoComplete="off"
        spellCheck="false"
        autoFocus
      />
    </form>
  );
}

function ProductPicker() {
  const { t } = useTranslation(SALES_NAMESPACE);
  const db = useLocalDb();
  const products = useQuery(localProductsQueryOptions(db));
  const add = useMutation({
    mutationFn: (productId: string) => addToCart(db, productId),
    networkMode: "always",
  });
  const columns: DataColumn<ProductView>[] = [
    {
      id: "name",
      header: t("pos.products.column.name"),
      isRowHeader: true,
      cell: (row) => row.name,
    },
    {
      id: "barcode",
      header: t("pos.products.column.barcode"),
      cell: (row) =>
        row.barcode === null ? null : (
          <bdi dir="ltr" className="font-mono">
            {row.barcode}
          </bdi>
        ),
    },
    {
      id: "price",
      header: t("pos.products.column.price"),
      align: "end",
      cell: (row) => (
        <Money value={KernelMoney.of(row.price.amount, priceCurrency(row.price.currency))} />
      ),
    },
    {
      id: "action",
      header: t("pos.products.column.action"),
      cell: (row) => (
        <Button
          variant="secondary"
          aria-label={t("pos.products.addNamed", { name: row.name })}
          onPress={() => {
            add.mutate(row.id);
          }}
        >
          {t("pos.products.add")}
        </Button>
      ),
    },
  ];
  return (
    <section aria-labelledby="pos-products-title" className="flex flex-col gap-density-gap">
      <h2 id="pos-products-title" className="text-lg font-semibold text-text">
        {t("pos.products.title")}
      </h2>
      {add.isError ? (
        <p role="alert" className="text-text-negative">
          {t("pos.cart.changeFailed")}
        </p>
      ) : null}
      <DataTable
        label={t("pos.products.title")}
        columns={columns}
        rows={products.data ?? []}
        rowId={(row) => row.id}
        emptyState={t("pos.products.empty")}
      />
    </section>
  );
}

function CartSection(props: {
  readonly device: LocalDevice;
  readonly userId: string;
  readonly receiptAction: PosScreenProps["receiptAction"];
}) {
  const { t } = useTranslation(SALES_NAMESPACE);
  const db = useLocalDb();
  const { clock, newId } = useClientRuntime();
  const digits = useDigitShape();
  const cart = useQuery(cartQueryOptions(db, props.device.baseCurrency));
  const [recorded, setRecorded] = useState<{ id: string; number: string } | undefined>();
  const remove = useMutation({
    mutationFn: (productId: string) => removeFromCart(db, productId),
    networkMode: "always",
  });
  const sale = useMutation({
    mutationFn: () =>
      completeCashSale(db, { device: props.device, userId: props.userId, clock, newId }),
    networkMode: "always",
    onSuccess: (done) => {
      setRecorded({ id: done.invoiceId, number: done.number });
    },
  });
  const columns: DataColumn<CartLine>[] = [
    {
      id: "name",
      header: t("pos.cart.column.name"),
      isRowHeader: true,
      cell: (line) =>
        line.name === undefined ? (
          <span className="text-text-negative">{t("pos.cart.missing")}</span>
        ) : (
          <span className="flex flex-col">
            <span>{line.name}</span>
            {line.sellable ? null : (
              <span className="text-sm text-text-negative">{t("pos.cart.otherCurrency")}</span>
            )}
          </span>
        ),
    },
    {
      id: "quantity",
      header: t("pos.cart.column.quantity"),
      align: "end",
      cell: (line) => (
        <bdi dir="ltr" className="tabular-nums">
          {formatDecimal(line.quantity.toString(), { digits })}
        </bdi>
      ),
    },
    {
      id: "price",
      header: t("pos.cart.column.price"),
      align: "end",
      cell: (line) => (line.unitPrice === undefined ? null : <Money value={line.unitPrice} />),
    },
    {
      id: "amount",
      header: t("pos.cart.column.amount"),
      align: "end",
      cell: (line) => (line.amount === undefined ? null : <Money value={line.amount} />),
    },
    {
      id: "action",
      header: t("pos.cart.column.action"),
      cell: (line) => (
        <Button
          variant="quiet"
          aria-label={t("pos.cart.removeNamed", { name: line.name ?? line.productId })}
          onPress={() => {
            remove.mutate(line.productId);
          }}
        >
          {t("pos.cart.remove")}
        </Button>
      ),
    },
  ];
  const current = cart.data;
  const reason =
    current === undefined || current.lines.length === 0
      ? "pos.emptyReason"
      : current.ready
        ? undefined
        : "pos.notSellableReason";

  return (
    <section aria-labelledby="pos-cart-title" className="flex flex-col gap-density-gap">
      <h2 id="pos-cart-title" className="text-lg font-semibold text-text">
        {t("pos.cart.title")}
      </h2>
      <DataTable
        label={t("pos.cart.title")}
        columns={columns}
        rows={current?.lines ?? []}
        rowId={(line) => line.productId}
        emptyState={t("pos.cart.empty")}
      />
      {current === undefined ? null : (
        <p
          data-testid="cart-total"
          className="flex items-baseline justify-between border-t-4 border-double border-signature pt-2 text-lg font-semibold text-text"
        >
          <span>{t("pos.cart.total")}</span>
          <Money value={current.total} className="text-xl" />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          isDisabled={reason !== undefined}
          isPending={sale.isPending}
          {...(reason === undefined ? {} : { "aria-describedby": "pos-complete-reason" })}
          onPress={() => {
            setRecorded(undefined);
            sale.mutate();
          }}
        >
          {sale.isPending ? t("pos.completing") : t("pos.complete")}
        </Button>
        {reason === undefined ? null : (
          <span id="pos-complete-reason" className="text-sm text-text-secondary">
            {t(reason)}
          </span>
        )}
      </div>
      {remove.isError ? (
        <p role="alert" className="text-text-negative">
          {t("pos.cart.changeFailed")}
        </p>
      ) : null}
      {sale.isError ? (
        <p role="alert" className="text-text-negative">
          {sale.error instanceof SaleRefused && sale.error.reason === "noDepartment"
            ? t("pos.noDepartment")
            : t("pos.failed")}
        </p>
      ) : null}
      <p role="status" className="text-text-positive">
        {recorded === undefined ? null : (
          <>
            {t("pos.recorded")}{" "}
            <bdi dir="ltr" data-testid="recorded-number" className="font-mono font-semibold">
              {recorded.number}
            </bdi>
          </>
        )}
      </p>
      {recorded === undefined || props.receiptAction === undefined ? null : (
        // A new sale gets a fresh receipt action, never the previous sale's state.
        <Fragment key={recorded.id}>
          {props.receiptAction({ ...recorded, deviceName: props.device.name, justSold: true })}
        </Fragment>
      )}
    </section>
  );
}

function RecentInvoices(props: {
  readonly device: LocalDevice;
  readonly receiptAction: PosScreenProps["receiptAction"];
}) {
  const { t } = useTranslation(SALES_NAMESPACE);
  const db = useLocalDb();
  const invoices = useQuery(localInvoicesQueryOptions(db));
  const columns: DataColumn<LocalInvoice>[] = [
    {
      id: "number",
      header: t("pos.recent.column.number"),
      isRowHeader: true,
      cell: (invoice) => (
        <bdi dir="ltr" className="font-mono">
          {invoice.number}
        </bdi>
      ),
    },
    {
      id: "total",
      header: t("pos.recent.column.total"),
      align: "end",
      cell: (invoice) => <Money value={invoice.total} />,
    },
    {
      id: "state",
      header: t("pos.recent.column.state"),
      cell: (invoice) =>
        invoice.syncState === undefined ? null : (
          <span
            className={
              invoice.syncState === "rejected"
                ? "text-text-negative"
                : invoice.syncState === "pending"
                  ? "text-text-secondary"
                  : "text-text-positive"
            }
          >
            {t(`pos.recent.state.${invoice.syncState}`)}
          </span>
        ),
    },
  ];
  const { receiptAction } = props;
  if (receiptAction !== undefined) {
    columns.push({
      id: "receipt",
      header: t("pos.recent.column.receipt"),
      cell: (invoice) =>
        receiptAction({
          id: invoice.id,
          number: invoice.number,
          deviceName: props.device.name,
          justSold: false,
        }),
    });
  }
  return (
    <section aria-labelledby="pos-recent-title" className="flex flex-col gap-density-gap">
      <h2 id="pos-recent-title" className="text-lg font-semibold text-text">
        {t("pos.recent.title")}
      </h2>
      <DataTable
        label={t("pos.recent.title")}
        columns={columns}
        rows={invoices.data ?? []}
        rowId={(invoice) => invoice.id}
        emptyState={t("pos.recent.empty")}
      />
    </section>
  );
}

/**
 * The minimal POS (flow 5): sells the products this device holds, for cash, from the local
 * database only — it works the same offline. Keyboard first: the barcode field has focus.
 */
export function PosScreen({ seller, registerDeviceLink, receiptAction }: PosScreenProps) {
  const { t } = useTranslation(SALES_NAMESPACE);
  const db = useLocalDb();
  const device = useQuery(localDeviceQueryOptions(db));

  let body: ReactNode;
  if (device.isError) {
    body = (
      <p role="alert" className="text-text-negative">
        {t("pos.localFailed")}
      </p>
    );
  } else if (device.data === undefined) {
    body = <p className="text-text-secondary">{t("pos.loading")}</p>;
  } else if (device.data === null) {
    body = (
      <div role="alert" className="flex flex-col gap-2 text-text">
        <p>{t("pos.unregistered")}</p>
        {registerDeviceLink}
      </div>
    );
  } else if (device.data.tenantId !== seller.tenantId) {
    body = (
      <p role="alert" className="text-text-negative">
        {t("pos.otherStore")}
      </p>
    );
  } else {
    body = (
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <ScanForm />
          <ProductPicker />
        </div>
        <div className="flex flex-col gap-8">
          <CartSection device={device.data} userId={seller.userId} receiptAction={receiptAction} />
          <RecentInvoices device={device.data} receiptAction={receiptAction} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold text-text">{t("pos.title")}</h1>
      {body}
    </div>
  );
}
