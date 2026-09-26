// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LicenseSummary } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE, organizationMessages } from "../messages.ts";
import { LicenseScreen } from "./license-screen.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ORGANIZATION_NAMESPACE]: organizationMessages,
});

const SUMMARY: LicenseSummary = {
  plan: "phonesPro",
  state: "active",
  expiresAt: "2027-09-25T08:00:00.000Z",
  readOnlyAt: "2027-10-02T08:00:00.000Z",
  suspendedAt: "2027-11-01T08:00:00.000Z",
  limits: [
    { limit: "users", used: 2, allowed: 6 },
    { limit: "departments", used: 4, allowed: 4 },
    { limit: "mainPosDevices", used: 4, allowed: 3 },
    { limit: "companionDevices", used: 0, allowed: 2 },
  ],
};

function answering(response: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    return Promise.resolve(response());
  });
  return calls;
}

function renderScreen(limitLink?: (limit: string) => string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div dir="rtl">
          <LicenseScreen
            {...(limitLink === undefined
              ? {}
              : { limitLink: (limit) => <a href={`#${limit}`}>{limitLink(limit)}</a> })}
          />
        </div>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the «License and plan» screen", () => {
  it("shows the plan, the state as a word, the expiry, and each limit as used of allowed", async () => {
    const calls = answering(() => Response.json(SUMMARY));
    renderScreen();
    expect(await screen.findByText("الاحترافية لمحلات الموبايل")).toBeInTheDocument();
    expect(calls).toEqual(["/api/v1/organization/license"]);
    expect(screen.getByText("ساري")).toBeInTheDocument();
    expect(screen.getAllByText("25 أيلول 2027").length).toBeGreaterThan(0);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "المستخدمون النشطون2 من 6",
      "الأقسام النشطة4 من 4مكتمل",
      "الأجهزة الرئيسية (كاشير)4 من 3متجاوز",
      "الأجهزة المساعدة (موبايل)0 من 2",
    ]);
  });

  it.each([
    ["expiring", "ينتهي قريبًا", "ينتهي الترخيص في 25 أيلول 2027"],
    ["grace", "مهلة سماح", "يصبح للقراءة فقط في 2 تشرين الأول 2027"],
    ["readOnly", "قراءة فقط", "لا يُسجَّل أي مستند جديد"],
    ["suspended", "موقوف", "المتجر موقوف منذ 1 تشرين الثاني 2027"],
  ] as const)("explains the %s state and when the next one begins", async (state, word, text) => {
    answering(() => Response.json({ ...SUMMARY, state }));
    renderScreen();
    expect(await screen.findByText(word)).toBeInTheDocument();
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
  });

  it("links each limit to where it is managed, as the app composes it", async () => {
    answering(() => Response.json(SUMMARY));
    renderScreen((limit) => `manage ${limit}`);
    expect(await screen.findByRole("link", { name: "manage users" })).toHaveAttribute(
      "href",
      "#users",
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("shows a plan it has no name for by its code", async () => {
    answering(() => Response.json({ ...SUMMARY, plan: "enterprise" }));
    renderScreen();
    expect(await screen.findByText("enterprise")).toBeInTheDocument();
  });

  it("says when the server cannot be reached, and tries again on request", async () => {
    let online = false;
    answering(() => {
      if (!online) throw new TypeError("Failed to fetch");
      return Response.json(SUMMARY);
    });
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent("لا اتصال بالخادم");
    online = true;
    await userEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("الاحترافية لمحلات الموبايل")).toBeInTheDocument();
  });
});
