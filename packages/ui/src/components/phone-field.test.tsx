// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "./locale-provider.tsx";
import { UI_NAMESPACE, uiMessages } from "./messages.ts";
import { EMPTY_PHONE, PhoneField, type PhoneValue, phoneValue } from "./phone-field.tsx";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages });

function wrap(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <LocaleProvider>
        <div dir="rtl">{node}</div>
      </LocaleProvider>
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
});

function Phone({ initial }: { readonly initial: PhoneValue }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PhoneField label="الهاتف 1" countryLabel="رمز الدولة" value={value} onChange={setValue} />
      <output data-testid="value">{`${value.country} ${value.number}`}</output>
    </>
  );
}

describe("PhoneField", () => {
  it("reads a number in Syria by default and groups it on leaving", async () => {
    const user = userEvent.setup();
    wrap(<Phone initial={EMPTY_PHONE} />);
    const number = screen.getByRole("textbox", { name: "الهاتف 1" });
    expect(number).toHaveAttribute("dir", "ltr");
    expect(number).toHaveAttribute("type", "tel");
    expect(screen.getByRole("button", { name: /رمز الدولة/ })).toHaveTextContent("+963");
    await user.type(number, "0944123456");
    await user.tab();
    expect(number).toHaveValue("0944 123 456");
    expect(screen.getByTestId("value")).toHaveTextContent("SY 0944 123 456");
  });

  it("moves the country code to a number typed with its own", async () => {
    const user = userEvent.setup();
    wrap(<Phone initial={EMPTY_PHONE} />);
    const number = screen.getByRole("textbox", { name: "الهاتف 1" });
    await user.type(number, "+961 3123456");
    await user.tab();
    expect(screen.getByTestId("value")).toHaveTextContent("LB 03 123 456");
    expect(screen.getByRole("button", { name: /رمز الدولة/ })).toHaveTextContent("+961");
  });

  it("keeps what is no real number as typed, for the form to say so", async () => {
    const user = userEvent.setup();
    wrap(<Phone initial={EMPTY_PHONE} />);
    const number = screen.getByRole("textbox", { name: "الهاتف 1" });
    await user.type(number, "1234");
    await user.tab();
    expect(number).toHaveValue("1234");
  });

  it("chooses the country from the list, Syria first", async () => {
    const user = userEvent.setup();
    wrap(<Phone initial={{ country: "SY", number: "03 123 456" }} />);
    await user.click(screen.getByRole("button", { name: /رمز الدولة/ }));
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("+963");
    await user.click(screen.getByRole("option", { name: /لبنان/ }));
    expect(screen.getByTestId("value")).toHaveTextContent("LB 03 123 456");
  });

  it("opens a stored number in its country and national form", () => {
    expect(phoneValue("+963944123456")).toEqual({ country: "SY", number: "0944 123 456" });
    expect(phoneValue("+9613123456")).toEqual({ country: "LB", number: "03 123 456" });
    // A number from before E.164 that is no real one is kept as it was, in Syria.
    expect(phoneValue("+9631234")).toEqual({ country: "SY", number: "+9631234" });
  });
});
