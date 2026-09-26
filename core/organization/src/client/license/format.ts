import { DEFAULT_TIME_ZONE, LOCALE } from "@mustawfi/i18n";

const DATE = new Intl.DateTimeFormat(`${LOCALE}-u-nu-latn`, {
  dateStyle: "long",
  timeZone: DEFAULT_TIME_ZONE,
});

/** A date as the store reads it: in Damascus, Western digits. */
export const formatDate = (iso: string) => DATE.format(new Date(iso));
