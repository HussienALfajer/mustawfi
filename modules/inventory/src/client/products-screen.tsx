import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { Money as KernelMoney } from "@mustawfi/kernel";
import {
  Button,
  type DataColumn,
  DataTable,
  Money,
  MoneyInput,
  readMoneyInput,
  TextInput,
} from "@mustawfi/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { barcodeSchema, inventoryProblemCodes, type ProductView } from "../shared/index.ts";
import { INVENTORY_NAMESPACE } from "./messages.ts";
import {
  createProduct,
  PRICE_CURRENCIES,
  priceCurrency,
  productsQueryKey,
  productsQueryOptions,
} from "./products.ts";

/** Unit prices keep up to six decimals, like their column (ADR-0018). */
const PRICE_SCALE = 6;

/** Field problems are message keys under `newProduct.`; price problems belong to `MoneyInput`. */
const newProductFormSchema = z
  .object({
    name: z.string().trim().min(1, "required").max(200, "tooLong"),
    barcode: z
      .string()
      .trim()
      .refine((text) => text === "" || barcodeSchema.safeParse(text).success, "barcodeInvalid"),
    price: z.string(),
    currency: z.string(),
  })
  .superRefine((form, context) => {
    const { problem } = readMoneyInput(form.price, priceCurrency(form.currency), {
      scale: PRICE_SCALE,
    });
    if (problem !== undefined)
      context.addIssue({ code: "custom", path: ["price"], message: problem });
  });

type NewProductForm = z.infer<typeof newProductFormSchema>;

const EMPTY_FORM: NewProductForm = {
  name: "",
  barcode: "",
  price: "",
  currency: PRICE_CURRENCIES[0]?.code ?? "SYP",
};

function NewProductSection() {
  const { t } = useTranslation(INVENTORY_NAMESPACE);
  const queryClient = useQueryClient();
  const [added, setAdded] = useState<string | undefined>();
  const form = useForm<NewProductForm>({
    resolver: zodResolver(newProductFormSchema),
    defaultValues: EMPTY_FORM,
  });
  const mutation = useMutation({
    mutationFn: (values: NewProductForm) => {
      const { money } = readMoneyInput(values.price, priceCurrency(values.currency), {
        scale: PRICE_SCALE,
      });
      if (money === undefined) throw new Error("the form schema let an invalid price through");
      return createProduct({
        name: values.name.trim(),
        ...(values.barcode.trim() === "" ? {} : { barcode: values.barcode.trim() }),
        price: { amount: money.amount.toString(), currency: money.currency.code },
      });
    },
    onSuccess: async (product, values) => {
      setAdded(product.name);
      form.reset({ ...EMPTY_FORM, currency: values.currency });
      await queryClient.invalidateQueries({ queryKey: productsQueryKey });
    },
    onError: (error) => {
      if (error instanceof ApiProblem && error.code === inventoryProblemCodes.barcodeTaken) {
        form.setError("barcode", { message: "barcodeTaken" }, { shouldFocus: true });
      }
    },
  });
  // Ready for the next product once the save has settled; the button keeps focus while pending.
  const { isSuccess, submittedAt } = mutation;
  useEffect(() => {
    if (isSuccess) form.setFocus("name");
  }, [form, isSuccess, submittedAt]);
  const fieldError = (message: string | undefined) =>
    message === undefined ? undefined : t(`newProduct.${message}`);
  const failure =
    mutation.error === null ||
    (mutation.error instanceof ApiProblem &&
      mutation.error.code === inventoryProblemCodes.barcodeTaken)
      ? undefined
      : mutation.error instanceof ApiUnreachable
        ? "newProduct.unreachable"
        : "newProduct.refused";

  return (
    <section aria-labelledby="new-product-title" className="flex flex-col gap-density-gap">
      <h2 id="new-product-title" className="text-lg font-semibold text-text">
        {t("newProduct.title")}
      </h2>
      <form
        noValidate
        className="grid grid-cols-1 items-start gap-density-gap rounded-md bg-surface p-4 md:grid-cols-3"
        onSubmit={(event) => {
          setAdded(undefined);
          void form.handleSubmit((values) => {
            mutation.mutate(values);
          })(event);
        }}
      >
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("newProduct.name")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              autoComplete="off"
            />
          )}
        />
        <Controller
          control={form.control}
          name="barcode"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("newProduct.barcode")}
              description={t("newProduct.barcodeHelp")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              dir="ltr"
              autoComplete="off"
              spellCheck="false"
            />
          )}
        />
        <Controller
          control={form.control}
          name="currency"
          render={({ field: currencyField }) => (
            <Controller
              control={form.control}
              name="price"
              render={({ field, fieldState }) => (
                <MoneyInput
                  label={t("newProduct.price")}
                  amount={field.value}
                  onAmountChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  name={field.name}
                  currency={priceCurrency(currencyField.value)}
                  currencies={PRICE_CURRENCIES}
                  onCurrencyChange={(currency) => {
                    currencyField.onChange(currency.code);
                  }}
                  scale={PRICE_SCALE}
                  problem={
                    fieldState.error?.message as
                      "required" | "notANumber" | "tooPrecise" | "negative" | undefined
                  }
                />
              )}
            />
          )}
        />
        <div className="flex flex-col gap-2 md:col-span-3">
          {failure === undefined ? null : (
            <p role="alert" className="text-text-negative">
              {t(failure)}
            </p>
          )}
          <p role="status" className="text-text-positive">
            {added === undefined ? null : t("newProduct.added", { name: added })}
          </p>
          <div>
            <Button type="submit" isPending={mutation.isPending}>
              {mutation.isPending ? t("newProduct.submitting") : t("newProduct.submit")}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

function ProductList() {
  const { t } = useTranslation(INVENTORY_NAMESPACE);
  const products = useQuery(productsQueryOptions());
  const columns: DataColumn<ProductView>[] = [
    { id: "name", header: t("products.column.name"), isRowHeader: true, cell: (row) => row.name },
    {
      id: "barcode",
      header: t("products.column.barcode"),
      cell: (row) =>
        row.barcode === null ? null : (
          <bdi dir="ltr" className="font-mono">
            {row.barcode}
          </bdi>
        ),
    },
    {
      id: "price",
      header: t("products.column.price"),
      align: "end",
      cell: (row) => (
        <Money value={KernelMoney.of(row.price.amount, priceCurrency(row.price.currency))} />
      ),
    },
  ];

  return (
    <section aria-labelledby="products-title" className="flex flex-col gap-density-gap">
      <div className="flex items-baseline gap-3">
        <h2 id="products-title" className="text-lg font-semibold text-text">
          {t("products.title")}
        </h2>
        {products.data === undefined ? null : (
          <span className="text-sm text-text-secondary">
            {t("products.count", { count: products.data.length })}
          </span>
        )}
      </div>
      {products.isError ? (
        <div role="alert" className="flex items-center gap-3 text-text-negative">
          <span>{t("products.loadFailed")}</span>
          <Button
            variant="secondary"
            onPress={() => {
              void products.refetch();
            }}
          >
            {t("products.retry")}
          </Button>
        </div>
      ) : products.data === undefined ? (
        <p className="text-text-secondary">{t("products.loading")}</p>
      ) : (
        <DataTable
          label={t("products.title")}
          columns={columns}
          rows={products.data}
          rowId={(row) => row.id}
          emptyState={t("products.empty")}
        />
      )}
    </section>
  );
}

/** Products: add one (online) and see the list. */
export function ProductsScreen() {
  return (
    <div className="flex flex-col gap-8">
      <NewProductSection />
      <ProductList />
    </div>
  );
}
