// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import * as ui from "../index.ts";
import { LocaleProvider } from "../components/locale-provider.tsx";
import { UI_NAMESPACE, uiMessages } from "../components/messages.ts";
import { ComponentGallery, GALLERY_COMPONENTS } from "./gallery.tsx";
import { GALLERY_NAMESPACE, galleryMessages } from "./messages.ts";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages, [GALLERY_NAMESPACE]: galleryMessages });

/** Exports that render nothing of their own: providers. */
const NOT_VISUAL = new Set(["LocaleProvider"]);

afterEach(cleanup);

function renderGallery() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LocaleProvider>
        <ComponentGallery />
      </LocaleProvider>
    </I18nextProvider>,
  );
}

describe("component gallery", () => {
  it("lists every component the package exports", () => {
    const components = Object.entries(ui)
      .filter(([name, value]) => /^[A-Z][a-z]/.test(name) && typeof value === "function")
      .map(([name]) => name)
      .filter((name) => !NOT_VISUAL.has(name));
    expect([...GALLERY_COMPONENTS].sort()).toEqual(components.sort());
  });

  it("shows every listed component in both themes and all three densities", () => {
    const { container } = renderGallery();
    const blocks = container.querySelectorAll<HTMLElement>("[data-theme][data-density]");
    const axes = [...blocks].map(
      (block) => `${block.dataset["theme"]}/${block.dataset["density"]}`,
    );
    expect(axes.sort()).toEqual(
      ["dark", "light"].flatMap((theme) =>
        ["comfortable", "compact", "touch"].map((density) => `${theme}/${density}`),
      ),
    );
    for (const block of blocks) {
      for (const name of GALLERY_COMPONENTS) {
        expect(block.querySelector(`[data-component="${name}"]`), name).not.toBeNull();
      }
    }
  });

  it("shows the palette, the semantic tokens, and every contrast pair", () => {
    renderGallery();
    const semantic = screen.getByRole("region", { name: galleryMessages.sections.semantic });
    expect(within(semantic).getByText("--mf-color-accent")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: galleryMessages.sections.contrast }),
    ).toHaveTextContent(/لا زوج راسب/);
  });
});
