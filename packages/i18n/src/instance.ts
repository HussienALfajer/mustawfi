import i18next, { type i18n } from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import { LANGUAGE, LOCALE } from "./locale.ts";

/** One namespace's messages: ICU message text by key (the six Arabic plural forms work). */
export type Messages = { readonly [key: string]: string | Messages };

/** Namespaces by name: one per module, shipped in the module's `client` entry (ADR-0023). */
export type Namespaces = Readonly<Record<string, Messages>>;

/**
 * A ready i18next instance for the app: Arabic, ICU messages (Western digits by default), the given namespaces, and no
 * fallback language — a missing key shows the key, so it is caught in review and tests.
 */
export function createI18n(namespaces: Namespaces): i18n {
  const instance = i18next.createInstance();
  void instance
    .use(new ICU({ parseLngForICU: () => `${LOCALE}-u-nu-latn` }))
    .use(initReactI18next)
    .init({
      lng: LANGUAGE,
      supportedLngs: [LANGUAGE],
      fallbackLng: false,
      resources: { [LANGUAGE]: namespaces },
      ns: Object.keys(namespaces),
      defaultNS: false,
      interpolation: { escapeValue: false },
      initAsync: false,
    });
  return instance;
}
