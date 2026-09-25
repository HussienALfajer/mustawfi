import { expect, type Page, test } from "@playwright/test";
import { e2eStore } from "./environment.ts";
import { signIn } from "./steps.ts";

/** A barcode no other journey uses. */
function newBarcode(): string {
  return `628${String(Date.now()).slice(-10)}`;
}

/** Flow 3: the owner adds a product online, priced in the store's currency (SYP). */
async function addProduct(page: Page, name: string, barcode: string, price: string) {
  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByLabel("اسم المنتج").fill(name);
  await page.getByLabel("الباركود", { exact: true }).fill(barcode);
  await page.getByLabel("سعر البيع").fill(price);
  await page.getByRole("button", { name: "إضافة المنتج" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(`أُضيف المنتج «${name}»`);
}

/** Flow 4: the owner issues a registration code and registers this browser, as a companion. */
async function registerDevice(page: Page): Promise<string> {
  await page.getByRole("link", { name: "هذا الجهاز" }).click();
  await page.getByRole("button", { name: "إصدار رمز تسجيل" }).click();
  const code = page.getByTestId("registration-code");
  await expect(code).toHaveText(/^\S+$/);
  await expect(page.getByLabel("رمز المتجر")).toHaveValue(e2eStore().storeCode);
  await page.getByLabel("رمز التسجيل").fill((await code.textContent()) ?? "");
  await page.getByLabel("اسم الجهاز").fill("الصندوق الرئيسي");
  await page.getByRole("button", { name: "تسجيل الجهاز" }).click();
  const prefix = page.getByTestId("device-prefix");
  await expect(prefix).toHaveText(/^[A-HJ-NP-Z2-9]{2}$/);
  // The browser is never the main POS (ADR-0019); the Windows app is.
  await expect(page.getByTestId("device-type")).toHaveText("جهاز مساعد");
  return (await prefix.textContent()) ?? "";
}

test("flows 1–7: register, pull, sell offline, push, and see the sale with its entry", async ({
  page,
  context,
}) => {
  // The app's own warnings and errors: among them, a local database opened without WAL and
  // synchronous = FULL (ADR-0019). The browser's reports of failed requests are expected here
  // (the 401 before sign-in, the requests made while offline).
  const warnings: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("Failed to load resource")) return;
    if (message.type() === "error" || message.type() === "warning") warnings.push(text);
  });
  // Flow 1 ran in the global setup (the `tenant:create` CLI); flow 2:
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const barcode = newBarcode();
  await addProduct(page, "سماعة سلكية", barcode, "12.5");
  const prefix = await registerDevice(page);

  // Flow 5: the device pulls the product, goes offline, and sells it.
  await page.getByRole("link", { name: "البيع" }).click();
  const sync = page.getByRole("status", { name: "حالة المزامنة" });
  const product = page
    .getByRole("grid", { name: "المنتجات على هذا الجهاز" })
    .getByRole("row")
    .filter({ hasText: barcode });
  await expect(product).toBeVisible();
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");

  await context.setOffline(true);
  await expect(sync.getByTestId("sync-phase")).toHaveText("غير متصل");
  const scan = page.getByLabel("الباركود");
  await expect(scan).toBeFocused();
  await page.keyboard.type(barcode);
  await page.keyboard.press("Enter");
  const cart = page.getByRole("grid", { name: "السلة" });
  await expect(cart.getByRole("row").filter({ hasText: "سماعة سلكية" })).toBeVisible();
  await expect(page.getByTestId("cart-total")).toHaveText("الإجمالي12.50ل.س");
  await page.getByRole("button", { name: "إتمام البيع نقدًا" }).click();

  const number = `${prefix}-INV-000001`;
  await expect(page.getByTestId("recorded-number")).toHaveText(number);
  await expect(cart.getByRole("row").filter({ hasText: "سماعة سلكية" })).toHaveCount(0);
  await expect(sync.getByTestId("sync-pending")).toHaveText("عملية واحدة بانتظار الإرسال");
  const recent = page
    .getByRole("grid", { name: "آخر فواتير هذا الجهاز" })
    .getByRole("row")
    .filter({ hasText: number });
  await expect(recent).toContainText("بانتظار الإرسال");

  // Flow 6: back online, the outbox is pushed and the server posts the sale.
  await context.setOffline(false);
  await expect(sync.getByTestId("sync-pending")).toHaveText("لا عمليات بانتظار الإرسال");
  await expect(sync.getByTestId("sync-phase")).toHaveText("متزامن");
  await expect(recent).toContainText("وصلت إلى الخادم");

  // Flow 7: the owner sees the sale and its balanced journal entry on the server.
  await page.getByRole("link", { name: "المبيعات" }).click();
  const invoice = page.getByRole("article", { name: number });
  await expect(invoice).toContainText("12.50");
  // No stock-receiving route yet, so every end-to-end sale goes below zero and is flagged.
  await expect(invoice).toContainText("مخزون سالب");
  const entry = invoice.getByRole("grid", { name: `القيد المحاسبي ${number}` });
  const debit = entry.getByRole("row").filter({ hasText: "1100" });
  const credit = entry.getByRole("row").filter({ hasText: "4100" });
  await expect(debit.getByRole("gridcell").nth(0)).toHaveText("12.50ل.س");
  await expect(debit.getByRole("gridcell").nth(1)).toHaveText("");
  await expect(credit.getByRole("gridcell").nth(0)).toHaveText("");
  await expect(credit.getByRole("gridcell").nth(1)).toHaveText("12.50ل.س");

  expect(warnings).toEqual([]);
});

test("keeps the cart when the page reloads mid-sale", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/products$/);
  const barcode = newBarcode();
  await addProduct(page, "كبل شحن", barcode, "4");
  await registerDevice(page);
  await page.getByRole("link", { name: "البيع" }).click();
  await page.getByRole("button", { name: "أضف كبل شحن إلى السلة" }).click();
  await page.getByRole("button", { name: "أضف كبل شحن إلى السلة" }).click();
  const line = page.getByRole("grid", { name: "السلة" }).getByRole("row").filter({
    hasText: "كبل شحن",
  });
  await expect(line).toContainText("8.00");

  await page.reload();
  await expect(line).toContainText("8.00");
  await expect(line.getByRole("gridcell").nth(0)).toHaveText("2");
});
