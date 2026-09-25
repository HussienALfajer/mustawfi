import { LOCALE } from "@mustawfi/i18n";
import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components";

/**
 * Gives React Aria the app's locale, so keyboard navigation, overlays, and its own messages
 * follow Arabic and right-to-left (ADR-0023) instead of the browser's language.
 */
export function LocaleProvider({ children }: { readonly children: ReactNode }) {
  return <I18nProvider locale={LOCALE}>{children}</I18nProvider>;
}
