import arabic400 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?url";
import arabic700 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2?url";
import latin400 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-400-normal.woff2?url";
import latin700 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-700-normal.woff2?url";
import type { ReceiptFontSource } from "@mustawfi/printing";

/** The receipt font's files, bundled with the app (ADR-0025): regular and bold, Arabic and Latin. */
export const RECEIPT_FONT_SOURCES: readonly ReceiptFontSource[] = [
  { subset: "arabic", weight: 400, url: arabic400 },
  { subset: "latin", weight: 400, url: latin400 },
  { subset: "arabic", weight: 700, url: arabic700 },
  { subset: "latin", weight: 700, url: latin700 },
];
