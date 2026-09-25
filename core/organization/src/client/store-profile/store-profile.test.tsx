// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreProfileView } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE, organizationMessages } from "../messages.ts";
import { bytesToBase64 } from "./queries.ts";
import { storeProfileFormSchema } from "./store-profile-form.tsx";
import { StoreProfileScreen } from "./store-profile-screen.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ORGANIZATION_NAMESPACE]: organizationMessages,
});

const PROFILE: StoreProfileView = {
  id: "0190a000-0000-7000-8000-000000000010",
  name: "موبايلات الحلبي",
  address: null,
  phones: ["0944 123 456"],
  taxNumber: null,
  commercialRegister: null,
  logo: null,
  updatedAt: "2026-09-25T10:00:00.000Z",
};

describe("store profile form schema", () => {
  it("is the server's schema, with empty phone fields left out", () => {
    expect(
      storeProfileFormSchema.parse({
        name: " متجر ",
        address: "",
        phones: ["", "+963 11 222", " "],
        taxNumber: "",
        commercialRegister: "",
      }),
    ).toEqual({
      name: "متجر",
      address: null,
      phones: ["+963 11 222"],
      taxNumber: null,
      commercialRegister: null,
    });
    expect(
      storeProfileFormSchema.safeParse({ name: "متجر", phones: ["هاتف", "", ""] }).success,
    ).toBe(false);
  });
});

describe("bytesToBase64", () => {
  it("encodes more bytes than one call's argument limit", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(Buffer.from(bytesToBase64(bytes), "base64")).toEqual(Buffer.from(bytes));
  });
});

function fakeApi(answer: (method: string, body: unknown) => Response) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body: unknown = init.body === undefined ? undefined : JSON.parse(init.body as string);
    calls.push({ method, url, body });
    return Promise.resolve(method === "GET" ? Response.json(PROFILE) : answer(method, body));
  });
  return calls;
}

function renderScreen(onDirtyChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div dir="rtl">
          <StoreProfileScreen onDirtyChange={onDirtyChange} />
        </div>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return onDirtyChange;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(cleanup);

describe("StoreProfileScreen", () => {
  it("saves with Ctrl+S, sending the phones typed and nothing for empty fields", async () => {
    const calls = fakeApi((_, body) =>
      Response.json({ ...PROFILE, ...(body as object), updatedAt: PROFILE.updatedAt }),
    );
    const onDirtyChange = renderScreen();
    const name = await screen.findByLabelText("اسم المتجر (مطلوب)");
    expect(name).toHaveValue("موبايلات الحلبي");
    await userEvent.clear(name);
    await userEvent.type(name, "الحلبي للموبايل{Enter}");
    // Enter moved on to the next field instead of submitting.
    expect(screen.getByLabelText("الهاتف 1")).toHaveFocus();
    expect(calls.filter((call) => call.method === "PUT")).toEqual([]);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await userEvent.keyboard("{Control>}s{/Control}");
    expect(await screen.findByText("حُفظت بيانات المتجر")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      name: "الحلبي للموبايل",
      address: null,
      phones: ["0944 123 456"],
      taxNumber: null,
      commercialRegister: null,
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps what was typed when the server refuses, and says why on the page", async () => {
    fakeApi(() =>
      Response.json(
        {
          type: "about:blank",
          title: "owner",
          status: 403,
          code: "access.permission.ownerRequired",
        },
        { status: 403 },
      ),
    );
    renderScreen();
    const name = await screen.findByLabelText("اسم المتجر (مطلوب)");
    await userEvent.clear(name);
    await userEvent.type(name, "اسم جديد");
    await userEvent.click(screen.getByRole("button", { name: /حفظ/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("مالك المتجر وحده");
    expect(name).toHaveValue("اسم جديد");
  });

  it("refuses a logo that is not a PNG or JPEG before uploading it", async () => {
    const calls = fakeApi(() => Response.json(PROFILE));
    renderScreen();
    await screen.findByLabelText("اسم المتجر (مطلوب)");
    const input = document.querySelector<HTMLInputElement>("input[type=file]");
    if (input === null) throw new Error("no file input");
    await userEvent.upload(
      input,
      new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39])], "logo.png", {
        type: "image/png",
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("PNG أو JPEG");
    });
    expect(calls.filter((call) => call.url.endsWith("/logo"))).toEqual([]);
  });
});
