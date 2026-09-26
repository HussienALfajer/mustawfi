// @vitest-environment jsdom
import type { LicenseRestriction } from "@mustawfi/core-tenancy/client";
import type { LicenseStanding } from "@mustawfi/core-tenancy/shared";
import { createI18n } from "@mustawfi/i18n";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORGANIZATION_NAMESPACE, organizationMessages } from "../messages.ts";
import {
  LicenseIndicator,
  type LicenseNotice,
  LicenseRestrictionMessage,
  serverLicenseNotice,
  StoreSuspendedScreen,
  suspendedFor,
} from "./license-notice.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ORGANIZATION_NAMESPACE]: organizationMessages,
});

function standing(state: LicenseStanding["state"]): LicenseStanding {
  return {
    state,
    expiresAt: "2026-10-05T08:00:00.000Z",
    readOnlyAt: "2026-10-12T08:00:00.000Z",
    suspendedAt: "2026-11-11T08:00:00.000Z",
  };
}

function show(element: ReactNode) {
  render(
    <I18nextProvider i18n={i18n}>
      <div dir="rtl">{element}</div>
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("the top bar's license warning (rule 10)", () => {
  it("warns owners of an expiring license and of the grace period, and nobody else", () => {
    show(
      <>
        <LicenseIndicator notice={serverLicenseNotice(standing("expiring"))} isOwner />
        <LicenseIndicator notice={serverLicenseNotice(standing("grace"))} isOwner />
      </>,
    );
    expect(screen.getAllByTestId("license-notice").map((notice) => notice.textContent)).toEqual([
      "ينتهي الترخيص في 5 تشرين الأول 2026",
      "انتهى الترخيص، ومهلة السماح حتى 12 تشرين الأول 2026",
    ]);
    cleanup();
    show(
      <>
        <LicenseIndicator notice={serverLicenseNotice(standing("expiring"))} isOwner={false} />
        <LicenseIndicator notice={serverLicenseNotice(standing("grace"))} isOwner={false} />
        <LicenseIndicator notice={serverLicenseNotice(standing("active"))} isOwner />
      </>,
    );
    expect(screen.queryByTestId("license-notice")).toBeNull();
  });

  it("explains a restriction to everyone who reaches it", () => {
    const restrictions: LicenseRestriction[] = [
      "readOnly",
      "suspended",
      "clockBehind",
      "clockWrong",
      "bundleMissing",
      "bundleRefused",
      "offlineTooLong",
    ];
    show(
      restrictions.map((restriction) => (
        <LicenseIndicator
          key={restriction}
          notice={{ standing: standing("active"), restriction }}
          isOwner={false}
        />
      )),
    );
    expect(screen.getAllByTestId("license-notice").map((notice) => notice.textContent)).toEqual([
      "المتجر للقراءة فقط",
      "المتجر موقوف",
      "ساعة الجهاز متأخرة",
      "ساعة الجهاز غير مضبوطة",
      "بانتظار إعدادات المتجر",
      "إعدادات المتجر لم تجتز التحقق",
      "الجهاز منقطع منذ مدة طويلة",
    ]);
  });

  it("links an owner's warning to «License and plan» when the app offers the link", () => {
    show(
      <LicenseIndicator
        notice={serverLicenseNotice(standing("expiring"))}
        isOwner
        link={(content) => <a href="/admin/license">{content}</a>}
      />,
    );
    expect(screen.getByRole("link", { name: /ينتهي الترخيص/ })).toHaveAttribute(
      "href",
      "/admin/license",
    );
  });

  it("takes read-only and suspended from the server's state for a client that is no device", () => {
    expect(serverLicenseNotice(standing("grace")).restriction).toBeNull();
    expect(serverLicenseNotice(standing("readOnly")).restriction).toBe("readOnly");
    expect(serverLicenseNotice(standing("suspended")).restriction).toBe("suspended");
  });
});

describe("why no new document is made (rule 9)", () => {
  it("names the day read-only began and what brings selling back", () => {
    const notice = { standing: standing("readOnly"), restriction: "readOnly" } as const;
    show(<LicenseRestrictionMessage notice={notice} />);
    const message = screen.getByTestId("license-restriction");
    expect(message).toHaveTextContent("لا يُسجَّل أي مستند جديد على هذا الجهاز الآن");
    expect(message).toHaveTextContent("المتجر للقراءة فقط منذ 12 تشرين الأول 2026");
    expect(message).toHaveTextContent("للتجديد يتواصل صاحب المتجر مع Vertex System.");
  });

  it("tells a device whose clock went back to set it right and reach the server", () => {
    const notice: LicenseNotice & { restriction: LicenseRestriction } = {
      standing: standing("active"),
      restriction: "clockBehind",
    };
    show(<LicenseRestrictionMessage notice={notice} />);
    const message = screen.getByTestId("license-restriction");
    expect(message).toHaveTextContent("صحّح التاريخ والوقت في الجهاز");
    expect(message).not.toHaveTextContent("للتجديد");
  });
});

describe("«Store suspended»", () => {
  it("turns away everyone but owners, from a device's held state as from the server's", () => {
    const onDevice: LicenseNotice = { standing: standing("suspended"), restriction: "suspended" };
    expect(suspendedFor(onDevice, false)).toBe(true);
    expect(suspendedFor(onDevice, true)).toBe(false);
    expect(suspendedFor(serverLicenseNotice(standing("suspended")), false)).toBe(true);
    // Read-only and the other restrictions stop documents, not people.
    for (const restriction of ["readOnly", "clockBehind", "bundleMissing"] as const) {
      expect(suspendedFor({ standing: standing("readOnly"), restriction }, false)).toBe(false);
    }
    expect(suspendedFor(undefined, false)).toBe(false);
  });

  it("says since when, that only owners come in, and signs out from the keyboard", async () => {
    const onSignOut = vi.fn();
    show(<StoreSuspendedScreen standing={standing("suspended")} onSignOut={onSignOut} />);
    expect(screen.getByRole("heading", { level: 1, name: "المتجر موقوف" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "ترخيص هذا المتجر موقوف منذ 11 تشرين الثاني 2026، فلا يدخل إلا المالكون حتى يُجدَّد.",
      ),
    ).toBeInTheDocument();
    const signOut = screen.getByRole("button", { name: "تسجيل الخروج" });
    expect(signOut).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("still explains itself when the client does not know the dates", () => {
    show(<StoreSuspendedScreen onSignOut={() => undefined} />);
    expect(
      screen.getByText("ترخيص هذا المتجر موقوف، فلا يدخل إلا المالكون حتى يُجدَّد."),
    ).toBeInTheDocument();
  });
});
