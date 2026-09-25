import type { DeviceType } from "@mustawfi/core-access/shared";
import type { ApiEndpoint } from "@mustawfi/core-config/client";
import type { LocalDb } from "@mustawfi/local-db";
import type { NativeLocalDb } from "@mustawfi/local-db/native";
import { isTauri } from "@mustawfi/local-db/tauri";
import type { RawPrinterTransport } from "@mustawfi/printing";

/** The local database as a platform opens it; the native shells can also copy it. */
export interface OpenedLocalDb {
  readonly db: LocalDb;
  readonly backup?: NativeLocalDb["backup"];
}

/**
 * Where this one UI runs (ADR-0010): what it registers as, how it reaches the API, and which
 * local database it opens. The composition root picks one at start-up.
 */
export interface ClientPlatform {
  readonly deviceType: DeviceType;
  readonly api: ApiEndpoint;
  readonly openLocalDb: () => Promise<OpenedLocalDb>;
  /** The receipt printer transport (ADR-0025); none in the browser, which is no printing client. */
  readonly openPrinter?: () => Promise<RawPrinterTransport>;
}

/** The database file's name on every platform. */
const LOCAL_DB_NAME = "mustawfi";

/**
 * The browser: a limited offline client (ADR-0010), never the main POS (ADR-0019) — it
 * registers as a companion. Same-origin API with the session cookie; SQLite WASM on OPFS.
 */
const browser: ClientPlatform = {
  deviceType: "companion",
  api: { origin: "", session: "cookie" },
  openLocalDb: async () => {
    const { openBrowserLocalDb } = await import("./local-browser.ts");
    return { db: await openBrowserLocalDb(LOCAL_DB_NAME) };
  },
};

/**
 * The Windows app (Tauri): the store's main POS, with its database in a native SQLite file.
 * Its page is served from the app itself, so it calls the server's origin (set at build time;
 * the development server proxies instead) with a bearer session.
 */
const windows: ClientPlatform = {
  deviceType: "mainPos",
  api: { origin: import.meta.env.VITE_MUSTAWFI_API_ORIGIN ?? "", session: "bearer" },
  openLocalDb: async () => {
    const { openTauriLocalDb } = await import("@mustawfi/local-db/tauri");
    return openTauriLocalDb(LOCAL_DB_NAME);
  },
  openPrinter: async () => (await import("@mustawfi/printing/tauri")).tauriPrinterTransport,
};

export function detectPlatform(): ClientPlatform {
  return isTauri() ? windows : browser;
}
