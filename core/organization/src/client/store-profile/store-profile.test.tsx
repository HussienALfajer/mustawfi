// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { ToastProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type StoreProfileView, storeProfileInputSchema } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE, organizationMessages } from "../messages.ts";
import { bytesToBase64 } from "./queries.ts";
import type { DecodedImage, LogoCodec } from "./reduce-logo.ts";
import {
  type StoreProfileDraft,
  StoreProfileForm,
  storeProfileFormSchema,
} from "./store-profile-form.tsx";
import { StoreProfileScreen } from "./store-profile-screen.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ORGANIZATION_NAMESPACE]: organizationMessages,
});

const PROFILE: StoreProfileView = {
  id: "0190a000-0000-7000-8000-000000000010",
  name: "موبايلات الحلبي",
  address: null,
  phones: ["+963944123456"],
  unreadablePhones: [],
  taxNumber: null,
  commercialRegister: null,
  logo: null,
  logoPrint: "threshold",
  updatedAt: "2026-09-25T10:00:00.000Z",
};

describe("store profile form schema", () => {
  const phone = (country: string, number: string) => ({ country, number });

  it("is the server's schema, phones in E.164 and empty ones left out", () => {
    expect(
      storeProfileFormSchema.parse({
        name: " متجر ",
        address: "",
        phones: [phone("SY", ""), phone("SY", "011 222 3344"), phone("LB", " 03 123 456 ")],
        taxNumber: "",
        commercialRegister: "",
        logoPrint: "dither",
      }),
    ).toEqual({
      name: "متجر",
      address: null,
      phones: ["+963112223344", "+9613123456"],
      taxNumber: null,
      commercialRegister: null,
      logoPrint: "dither",
    });
  });

  it("refuses a number that is not real in its country, on that phone's number", () => {
    const result = storeProfileFormSchema.safeParse({
      name: "متجر",
      phones: [phone("SY", "0944 123 456"), phone("SY", "1234"), phone("SY", "")],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["phones", 1, "number"]]);
    expect(
      storeProfileFormSchema.safeParse({
        name: "متجر",
        phones: [phone("XX", "0944123456"), phone("SY", ""), phone("SY", "")],
      }).success,
    ).toBe(false);
  });

  it("refuses the same number twice, however written, on the phone that repeats it", () => {
    const result = storeProfileFormSchema.safeParse({
      name: "متجر",
      phones: [phone("SY", "0944 123 456"), phone("SY", ""), phone("LB", "+963944123456")],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([
      { path: ["phones", 2, "number"], message: "phoneRepeated" },
    ]);
    // The server refuses it too, if a client sends it.
    expect(
      storeProfileInputSchema.safeParse({ name: "متجر", phones: ["0944123456", "+963944123456"] })
        .success,
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

function providers(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <div dir="rtl">{node}</div>
        </QueryClientProvider>
      </ToastProvider>
    </I18nextProvider>
  );
}

/** The last draft the receipt preview was given. */
let lastDraft: StoreProfileDraft | undefined;
const preview = (draft: StoreProfileDraft) => {
  lastDraft = draft;
  return <output data-testid="preview">{draft.name}</output>;
};

function renderScreen(onDirtyChange = vi.fn()) {
  render(providers(<StoreProfileScreen onDirtyChange={onDirtyChange} preview={preview} />));
  return onDirtyChange;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  if (input === null) throw new Error("no file input");
  return input;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  lastDraft = undefined;
});

afterEach(cleanup);

describe("StoreProfileScreen", () => {
  it("saves with Ctrl+S, sending the phones in E.164 and nothing for empty fields", async () => {
    const calls = fakeApi((_, body) =>
      Response.json({ ...PROFILE, ...(body as object), updatedAt: PROFILE.updatedAt }),
    );
    const onDirtyChange = renderScreen();
    const name = await screen.findByLabelText("اسم المتجر (مطلوب)");
    expect(name).toHaveValue("موبايلات الحلبي");
    // The stored number opens in its country, grouped.
    expect(screen.getByLabelText("الهاتف 1")).toHaveValue("0944 123 456");
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
      phones: ["+963944123456"],
      taxNumber: null,
      commercialRegister: null,
      logoPrint: "threshold",
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("offers «تراجع عن التغييرات» only while there are unsaved changes, beside why", async () => {
    fakeApi(() => new Response(null, { status: 500 }));
    renderScreen();
    const name = await screen.findByLabelText("اسم المتجر (مطلوب)");
    expect(screen.queryByRole("button", { name: "تراجع عن التغييرات" })).toBeNull();
    await userEvent.type(name, " الجديد");
    expect(screen.getByText("تغييرات غير محفوظة")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "تراجع عن التغييرات" }));
    expect(name).toHaveValue("موبايلات الحلبي");
    // The button is gone; focus is not lost with it.
    expect(name).toHaveFocus();
    expect(screen.queryByRole("button", { name: "تراجع عن التغييرات" })).toBeNull();
    expect(screen.queryByText("تغييرات غير محفوظة")).toBeNull();
  });

  it("keeps what was typed when the server refuses, and says why on the page", async () => {
    fakeApi(() =>
      Response.json(
        {
          type: "about:blank",
          title: "denied",
          status: 403,
          code: "access.permission.denied",
        },
        { status: 403 },
      ),
    );
    renderScreen();
    const name = await screen.findByLabelText("اسم المتجر (مطلوب)");
    await userEvent.clear(name);
    await userEvent.type(name, "اسم جديد");
    await userEvent.click(screen.getByRole("button", { name: /حفظ/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يسمح لك دورك");
    expect(name).toHaveValue("اسم جديد");
  });

  it("says the store is read-only when the license stops a save (QA slice 24)", async () => {
    fakeApi(() =>
      Response.json(
        { type: "about:blank", title: "no", status: 403, code: "tenancy.license.readOnly" },
        { status: 403 },
      ),
    );
    renderScreen();
    const name = await screen.findByLabelText("اسم المتجر (مطلوب)");
    await userEvent.type(name, " الجديد");
    await userEvent.click(screen.getByRole("button", { name: /حفظ/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "المتجر للقراءة فقط لأن الترخيص لم يُجدَّد، فلا يُحفظ أي تغيير",
    );
  });

  it("saves a phone typed with its own country code in E.164, and says a wrong one on its field", async () => {
    const calls = fakeApi((_, body) => Response.json({ ...PROFILE, ...(body as object) }));
    renderScreen();
    const second = await screen.findByLabelText("الهاتف 2");
    await userEvent.type(second, "1234");
    await userEvent.keyboard("{Control>}s{/Control}");
    await waitFor(() => {
      expect(second).toHaveAccessibleDescription(/ليس رقم هاتف صحيحًا في الدولة المختارة/);
    });
    expect(calls.filter((call) => call.method === "PUT")).toEqual([]);
    await userEvent.clear(second);
    await userEvent.type(second, "+961 3 123456");
    await userEvent.tab();
    // Leaving the number groups it and moves its country code to Lebanon.
    expect(second).toHaveValue("03 123 456");
    expect(screen.getByRole("button", { name: /رمز الدولة للهاتف 2/ })).toHaveTextContent("+961");
    await userEvent.keyboard("{Control>}s{/Control}");
    expect(await screen.findByText("حُفظت بيانات المتجر")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      phones: ["+963944123456", "+9613123456"],
    });
  });

  it("shows a phone that could not be read before E.164 as typed, flagged, and replaces it on save", async () => {
    const calls = fakeApi((_, body) => Response.json({ ...PROFILE, ...(body as object) }));
    render(
      providers(
        <StoreProfileForm profile={{ ...PROFILE, unreadablePhones: ["0944123456 0933123456"] }} />,
      ),
    );
    expect(screen.getByText(/رقم محفوظ من قبل ليس رقم هاتف صحيحًا/)).toBeInTheDocument();
    const second = screen.getByLabelText("الهاتف 2");
    expect(second).toHaveValue("0944123456 0933123456");
    await waitFor(() => {
      expect(second).toHaveAccessibleDescription(/ليس رقم هاتف صحيحًا في الدولة المختارة/);
    });
    await userEvent.clear(second);
    await userEvent.type(second, "0933123456");
    await userEvent.keyboard("{Control>}s{/Control}");
    expect(await screen.findByText("حُفظت بيانات المتجر")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      phones: ["+963944123456", "+963933123456"],
    });
  });

  it("flags a phone stored before E.164 that is no real number, at once", async () => {
    fakeApi(() => Response.json(PROFILE));
    render(
      providers(
        <StoreProfileForm profile={{ ...PROFILE, phones: ["+963944123456", "+9631234"] }} />,
      ),
    );
    expect(screen.getByText(/رقم محفوظ من قبل ليس رقم هاتف صحيحًا/)).toBeInTheDocument();
    const second = screen.getByLabelText("الهاتف 2");
    expect(second).toHaveValue("+9631234");
    await waitFor(() => {
      expect(second).toHaveAccessibleDescription(/ليس رقم هاتف صحيحًا في الدولة المختارة/);
    });
    expect(screen.getByLabelText("الهاتف 1")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("previews the receipt from what the form holds now, before saving", async () => {
    fakeApi(() => Response.json(PROFILE));
    renderScreen();
    const name = await screen.findByLabelText("اسم المتجر (مطلوب)");
    expect(screen.getByRole("complementary", { name: "معاينة الإيصال" })).toBeInTheDocument();
    await userEvent.type(name, " الجديد");
    expect(screen.getByTestId("preview")).toHaveTextContent("موبايلات الحلبي الجديد");
    await userEvent.type(screen.getByLabelText("الهاتف 2"), "011 222 3344");
    await userEvent.click(screen.getByRole("radio", { name: "صورة" }));
    expect(lastDraft).toMatchObject({
      name: "موبايلات الحلبي الجديد",
      phones: ["+963944123456", "+963112223344"],
      logoPrint: "dither",
      logo: null,
    });
    // The chosen mode explains itself, and is saved with the form.
    expect(screen.getByText(/الأنسب لصورة فوتوغرافية/)).toBeInTheDocument();
    expect(screen.getByText("تغييرات غير محفوظة")).toBeInTheDocument();
  });

  it("refuses a logo of another type before reading it", async () => {
    const calls = fakeApi(() => Response.json(PROFILE));
    renderScreen();
    await screen.findByLabelText("اسم المتجر (مطلوب)");
    await userEvent.upload(
      fileInput(),
      new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39])], "logo.gif", {
        type: "image/gif",
      }),
      { applyAccept: false },
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("PNG أو JPEG أو WebP");
    });
    expect(calls.filter((call) => call.url.endsWith("/logo"))).toEqual([]);
  });

  it("reduces a large chosen logo before uploading it, and saves it at once", async () => {
    const calls = fakeApi(() =>
      Response.json({
        ...PROFILE,
        logo: { type: "image/png", sha256: "b".repeat(64), size: 3 },
      }),
    );
    const encoded: string[] = [];
    const codec: LogoCodec<DecodedImage> = {
      decode: () => Promise.resolve({ width: 2400, height: 1200 }),
      encode: (_image, width, height, type) => {
        encoded.push(`${type} ${String(width)}x${String(height)}`);
        return Promise.resolve(new Blob([new Uint8Array([0x89, 0x50, 0x4e])]));
      },
    };
    render(providers(<StoreProfileForm profile={PROFILE} logoCodec={codec} />));
    // Four megabytes: over the stored limit, under what may be chosen.
    await userEvent.upload(
      fileInput(),
      new File([new Uint8Array(4 * 1024 * 1024)], "photo.png", { type: "image/png" }),
    );
    expect(await screen.findByText("حُفظ الشعار الجديد")).toBeInTheDocument();
    expect(encoded).toEqual(["image/png 512x256"]);
    const upload = calls.find((call) => call.method === "PUT" && call.url.endsWith("/logo"));
    expect(upload?.body).toEqual({ data: bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e])) });
  });
});
