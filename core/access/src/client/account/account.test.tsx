// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AccountView, accessProblemCodes } from "../../shared/index.ts";
import { LoginScreen } from "../login-screen.tsx";
import { ACCESS_NAMESPACE, accessMessages } from "../messages.ts";
import { PasswordResetScreen } from "../password-reset-screen.tsx";
import { AccountScreen } from "./account-screen.tsx";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages, [ACCESS_NAMESPACE]: accessMessages });

const SESSION = {
  tenantId: "0190a000-0000-7000-8000-00000000f001",
  expiresAt: "2026-10-03T08:00:00.000Z",
  token: "s1.token",
  user: {
    id: "0190a000-0000-7000-8000-00000000c001",
    name: "سامر",
    login: "owner",
    role: { id: "0190a000-0000-7000-8000-00000000b001", name: "المالك", isOwner: true },
    departmentScope: "all",
    departments: [],
    permissions: [],
  },
};

function account(extra: Partial<AccountView> = {}): AccountView {
  return {
    id: SESSION.user.id,
    name: "سامر",
    login: "owner",
    hasPassword: true,
    hasPin: false,
    twoFactor: { enabled: false, enabledAt: null, recoveryCodesLeft: 0 },
    ...extra,
  };
}

function problem(status: number, code: string): Response {
  return Response.json({ type: "about:blank", title: code, status, code }, { status });
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: Record<string, unknown> | undefined;
}

/** A fake API answering `METHOD url` from `answers`, in order when an answer is a list. */
function fakeApi(answers: Record<string, (() => Response) | (() => Response)[]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({
      method,
      url,
      body:
        init.body === undefined
          ? undefined
          : (JSON.parse(init.body as string) as Record<string, unknown>),
    });
    const answer = answers[`${method} ${url}`];
    const next = Array.isArray(answer) ? answer.shift() : answer;
    if (next === undefined) throw new Error(`no answer for ${method} ${url}`);
    return Promise.resolve(next());
  });
  return calls;
}

function renderWith(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div dir="rtl">{children}</div>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(cleanup);

describe("sign-in with two-factor authentication (core-foundation rule 26)", () => {
  async function typePassword() {
    await userEvent.type(screen.getByLabelText("رمز المتجر"), "K7M3Q9");
    await userEvent.type(screen.getByLabelText("اسم الدخول"), "owner");
    await userEvent.type(screen.getByLabelText("كلمة المرور"), "a long enough password{Enter}");
  }

  it("asks for the code after the right password and sends it with the password", async () => {
    const calls = fakeApi({
      "POST /api/v1/access/login": [
        () => problem(401, accessProblemCodes.secondFactorRequired),
        () => problem(401, accessProblemCodes.secondFactorInvalid),
        () => Response.json(SESSION),
      ],
    });
    const onSignedIn = vi.fn();
    renderWith(<LoginScreen onSignedIn={onSignedIn} />);
    await typePassword();

    const code = await screen.findByLabelText("رمز التحقق");
    expect(code).toHaveFocus();
    expect(screen.getByRole("heading", { name: "التحقق بخطوتين" })).toBeVisible();
    // The request for a code is a step, not a failure.
    expect(screen.queryByRole("alert")).toBeNull();

    await userEvent.type(code, "000000{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("الرمز غير صحيح أو استُخدم من قبل");
    await userEvent.clear(code);
    await userEvent.type(code, "123456{Enter}");
    await vi.waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledOnce();
    });
    expect(calls[0]?.body).not.toHaveProperty("secondFactor");
    expect(calls.map((call) => call.body)).toEqual([
      expect.objectContaining({ password: "a long enough password" }),
      expect.objectContaining({ password: "a long enough password", secondFactor: "000000" }),
      expect.objectContaining({ login: "owner", secondFactor: "123456" }),
    ]);
  });

  it("goes back to the password step", async () => {
    fakeApi({
      "POST /api/v1/access/login": () => problem(401, accessProblemCodes.secondFactorRequired),
    });
    renderWith(<LoginScreen onSignedIn={vi.fn()} />);
    await typePassword();
    await userEvent.click(await screen.findByRole("button", { name: "رجوع" }));
    // What was typed stays, but the password: it is typed again.
    expect(screen.getByLabelText("رمز المتجر")).toHaveValue("K7M3Q9");
    expect(screen.getByLabelText("اسم الدخول")).toHaveValue("owner");
    expect(screen.getByLabelText("كلمة المرور")).toHaveValue("");
  });

  it("offers the recovery link and says when the password was just reset", () => {
    renderWith(
      <LoginScreen
        onSignedIn={vi.fn()}
        passwordWasReset
        recoveryLink={(label) => <a href="/recover">{label}</a>}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("عُيّنت كلمة المرور الجديدة");
    expect(screen.getByRole("link", { name: /نسيت كلمة المرور/ })).toHaveAttribute(
      "href",
      "/recover",
    );
  });
});

describe("recovery with a support reset code (rule 27)", () => {
  function renderRecovery(onReset = vi.fn()) {
    renderWith(
      <PasswordResetScreen onReset={onReset} backLink={(label) => <a href="/login">{label}</a>} />,
    );
    return onReset;
  }

  async function fill(values: { password: string; confirm: string; pin?: string }) {
    await userEvent.type(screen.getByLabelText("رمز المتجر"), "K7M3Q9");
    await userEvent.type(screen.getByLabelText("اسم الدخول"), "owner");
    await userEvent.type(screen.getByLabelText("رمز الاستعادة"), "ABCDE-FGHJK");
    await userEvent.type(screen.getByLabelText("كلمة المرور الجديدة"), values.password);
    await userEvent.type(screen.getByLabelText("أعد كتابة كلمة المرور الجديدة"), values.confirm);
    if (values.pin !== undefined) {
      await userEvent.type(screen.getByLabelText("رمز سري جديد (اختياري)"), values.pin);
    }
    await userEvent.click(screen.getByRole("button", { name: "تعيين كلمة المرور" }));
  }

  it("checks the new password on the page before sending anything", async () => {
    const calls = fakeApi({});
    renderRecovery();
    await fill({ password: "short", confirm: "other", pin: "1234" });
    expect(screen.getByLabelText("كلمة المرور الجديدة")).toHaveAccessibleDescription(
      /عشرة أحرف على الأقل/,
    );
    expect(screen.getByLabelText("أعد كتابة كلمة المرور الجديدة")).toBeInvalid();
    expect(screen.getByLabelText("رمز سري جديد (اختياري)")).toBeInvalid();
    expect(calls).toEqual([]);
  });

  it("sets the new password with the code, a PIN only when typed", async () => {
    const calls = fakeApi({
      "POST /api/v1/access/password-reset": () => new Response(null, { status: 204 }),
    });
    const onReset = renderRecovery();
    await fill({ password: "a brand new password", confirm: "a brand new password" });
    await vi.waitFor(() => {
      expect(onReset).toHaveBeenCalledOnce();
    });
    expect(calls[0]?.body).toEqual({
      storeCode: "K7M3Q9",
      login: "owner",
      code: "ABCDE-FGHJK",
      password: "a brand new password",
    });
  });

  it("says a used, expired, or wrong code in words", async () => {
    fakeApi({
      "POST /api/v1/access/password-reset": () => problem(401, accessProblemCodes.resetCodeInvalid),
    });
    const onReset = renderRecovery();
    await fill({ password: "a brand new password", confirm: "a brand new password", pin: "2580" });
    expect(await screen.findByRole("alert")).toHaveTextContent("رمز الاستعادة غير صحيح");
    expect(onReset).not.toHaveBeenCalled();
  });
});

describe("«My account» (flow 11)", () => {
  it("changes the PIN proved by the password while there is none, and hides nothing it needs", async () => {
    const calls = fakeApi({
      "GET /api/v1/access/me": () => Response.json(account()),
      "PUT /api/v1/access/me/pin": () => new Response(null, { status: 204 }),
    });
    renderWith(<AccountScreen />);
    const pin = await screen.findByRole("form", { name: "الرمز السري" });
    await userEvent.type(within(pin).getByLabelText("كلمة المرور الحالية"), "current password");
    await userEvent.type(within(pin).getByLabelText("الرمز السري الجديد"), "2580");
    await userEvent.type(within(pin).getByLabelText("أعد كتابة الرمز الجديد"), "2580{Enter}");
    expect(await within(pin).findByRole("status")).toHaveTextContent("تغيّر رمزك السري");
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      currentPassword: "current password",
      pin: "2580",
    });
    expect(within(pin).getByLabelText("الرمز السري الجديد")).toHaveValue("");
    expect(screen.getByRole("form", { name: "كلمة المرور" })).toBeVisible();
  });

  it("refuses a PIN that breaks the rules before sending it", async () => {
    const calls = fakeApi({ "GET /api/v1/access/me": () => Response.json(account()) });
    renderWith(<AccountScreen />);
    const pin = await screen.findByRole("form", { name: "الرمز السري" });
    await userEvent.type(within(pin).getByLabelText("كلمة المرور الحالية"), "x");
    await userEvent.type(within(pin).getByLabelText("الرمز السري الجديد"), "1234");
    await userEvent.type(within(pin).getByLabelText("أعد كتابة الرمز الجديد"), "1234{Enter}");
    expect(within(pin).getByLabelText("الرمز السري الجديد")).toBeInvalid();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("sets up two-factor authentication: password, QR code and key, first code, recovery codes once", async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `ABCD${String(i + 2)}-FGHJK`);
    const calls = fakeApi({
      "GET /api/v1/access/me": [
        () => Response.json(account()),
        () =>
          Response.json(
            account({
              twoFactor: {
                enabled: true,
                enabledAt: "2026-09-26T08:00:00.000Z",
                recoveryCodesLeft: 10,
              },
            }),
          ),
      ],
      "POST /api/v1/access/me/two-factor/enrolment": () =>
        Response.json(
          {
            secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
            uri: "otpauth://totp/Mustawfi:owner%40K7M3Q9?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
          },
          { status: 201 },
        ),
      "POST /api/v1/access/me/two-factor/confirm": [
        () => problem(422, accessProblemCodes.twoFactorCodeInvalid),
        () => Response.json({ recoveryCodes: codes }),
      ],
    });
    renderWith(<AccountScreen />);
    const section = await screen.findByRole("region", { name: "التحقق بخطوتين" });
    await userEvent.type(within(section).getByLabelText("كلمة المرور الحالية"), "my password");
    await userEvent.click(
      within(section).getByRole("button", { name: "بدء إعداد التحقق بخطوتين" }),
    );

    expect(await within(section).findByRole("img", { name: /رمز مربّع/ })).toBeInTheDocument();
    expect(within(section).getByLabelText("المفتاح")).toHaveTextContent(
      "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
    );
    const code = within(section).getByLabelText("الرمز من التطبيق");
    expect(code).toHaveFocus();
    await userEvent.type(code, "111111{Enter}");
    expect(await within(section).findByRole("alert")).toHaveTextContent("الرمز غير صحيح");
    await userEvent.clear(code);
    await userEvent.type(code, "222222{Enter}");

    const list = await within(section).findByRole("list", { name: "رموز الاسترداد" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(codes);
    expect(within(section).getByRole("heading", { name: "فُعّل التحقق بخطوتين" })).toHaveFocus();
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([
      { currentPassword: "my password" },
      { code: "111111" },
      { code: "222222" },
    ]);

    await userEvent.click(within(section).getByRole("button", { name: "حفظتُ الرموز" }));
    expect(await within(section).findByText("بقيت لك 10 رموز استرداد")).toBeVisible();
    expect(within(section).queryByRole("list", { name: "رموز الاسترداد" })).toBeNull();
  });

  it("turns it off with the password and a code, showing the codes left", async () => {
    const calls = fakeApi({
      "GET /api/v1/access/me": [
        () =>
          Response.json(
            account({
              hasPin: true,
              twoFactor: {
                enabled: true,
                enabledAt: "2026-09-20T08:00:00.000Z",
                recoveryCodesLeft: 2,
              },
            }),
          ),
        () => Response.json(account({ hasPin: true })),
      ],
      "POST /api/v1/access/me/two-factor/disable": () => new Response(null, { status: 204 }),
    });
    renderWith(<AccountScreen />);
    const section = await screen.findByRole("region", { name: "التحقق بخطوتين" });
    expect(within(section).getByText("بقي لك رمزا استرداد")).toBeVisible();
    await userEvent.type(within(section).getByLabelText("كلمة المرور الحالية"), "my password");
    await userEvent.type(
      within(section).getByLabelText("الرمز من التطبيق أو رمز استرداد"),
      "ABCDE-FGHJK",
    );
    await userEvent.click(within(section).getByRole("button", { name: "إيقاف التحقق بخطوتين" }));
    expect(
      await within(section).findByRole("button", { name: "بدء إعداد التحقق بخطوتين" }),
    ).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      currentPassword: "my password",
      code: "ABCDE-FGHJK",
    });
  });

  it("explains that a PIN-only user needs a password, and has no password section without a login", async () => {
    fakeApi({
      "GET /api/v1/access/me": () =>
        Response.json(account({ login: null, hasPassword: false, hasPin: true })),
    });
    renderWith(<AccountScreen />);
    const section = await screen.findByRole("region", { name: "التحقق بخطوتين" });
    expect(section).toHaveTextContent("عيّن كلمة مرور أولًا");
    expect(screen.queryByRole("form", { name: "كلمة المرور" })).toBeNull();
    expect(
      within(screen.getByRole("form", { name: "الرمز السري" })).getByLabelText(
        "الرمز السري الحالي",
      ),
    ).toBeVisible();
  });
});
