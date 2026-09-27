// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductView } from "../shared/index.ts";
import { INVENTORY_NAMESPACE, inventoryMessages } from "./messages.ts";
import { ProductsScreen } from "./products-screen.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [INVENTORY_NAMESPACE]: inventoryMessages,
});

const CHARGER: ProductView = {
  id: "0190a000-0000-7000-8000-000000000001",
  name: "شاحن سريع",
  barcode: "8806095467108",
  price: { amount: "5", currency: "USD" },
  createdAt: "2026-09-27T10:00:00.000Z",
};

function renderScreen(canManage: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div dir="rtl">
          <ProductsScreen canManage={canManage} />
        </div>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ items: [CHARGER], next: null })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProductsScreen", () => {
  it("offers the new product form to a user who may manage products", async () => {
    renderScreen(true);
    expect(await screen.findByRole("grid", { name: "المنتجات" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "إضافة منتج" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "اسم المنتج" })).toBeInTheDocument();
  });

  it("shows only the list to a user who may not: the server would refuse the form (QA slice 23)", async () => {
    renderScreen(false);
    const table = await screen.findByRole("grid", { name: "المنتجات" });
    expect(within(table).getByRole("rowheader", { name: "شاحن سريع" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "إضافة منتج" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "إضافة المنتج" })).toBeNull();
  });

  it("says on the field that a price is beyond what a device holds, and sends nothing (QA slice 23)", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit = {}) => {
      if (init.method === "POST") posts.push(init.body);
      return Promise.resolve(Response.json({ items: [CHARGER], next: null }));
    });
    const user = userEvent.setup();
    renderScreen(true);
    await user.type(await screen.findByRole("textbox", { name: "اسم المنتج" }), "كتاب");
    // An ISBN scanned into the price field: the scanner types its digits and Enter.
    await user.type(screen.getByRole("textbox", { name: "سعر البيع" }), "9780201379624{Enter}");
    expect(
      await screen.findByText("المبلغ كبير جدًا: 12 خانة على الأكثر قبل الفاصلة"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "سعر البيع" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(posts).toEqual([]);
  });

  it("says the store is read-only when the license stops a new product (QA slice 24)", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit = {}) =>
      Promise.resolve(
        init.method === "POST"
          ? Response.json(
              { type: "about:blank", title: "no", status: 403, code: "tenancy.license.readOnly" },
              { status: 403 },
            )
          : Response.json({ items: [CHARGER], next: null }),
      ),
    );
    const user = userEvent.setup();
    renderScreen(true);
    await user.type(await screen.findByRole("textbox", { name: "اسم المنتج" }), "كتاب");
    await user.type(screen.getByRole("textbox", { name: "سعر البيع" }), "12{Enter}");
    expect(
      await screen.findByText(/المتجر للقراءة فقط لأن الترخيص لم يُجدَّد، فلا يُضاف منتج/),
    ).toBeInTheDocument();
  });
});
