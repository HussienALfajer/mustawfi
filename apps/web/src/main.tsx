import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { ACCESS_NAMESPACE, accessMessages } from "@mustawfi/core-access/client";
import { AUDIT_NAMESPACE, auditMessages } from "@mustawfi/core-audit/client";
import { TENANCY_NAMESPACE, tenancyMessages } from "@mustawfi/core-tenancy/client";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ORGANIZATION_NAMESPACE, organizationMessages } from "@mustawfi/core-organization/client";
import { ApiProblem, ClientRuntimeProvider, configureApi } from "@mustawfi/core-config/client";
import { SYNC_NAMESPACE, SyncEngineProvider, syncMessages } from "@mustawfi/core-sync/client";
import { createI18n, DIRECTION, LANGUAGE } from "@mustawfi/i18n";
import { INVENTORY_NAMESPACE, inventoryMessages } from "@mustawfi/inventory/client";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { loadReceiptFonts } from "@mustawfi/printing";
import { LocalDbProvider } from "@mustawfi/local-db";
import { SALES_NAMESPACE, salesMessages } from "@mustawfi/sales/client";
import { LocaleProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import { GALLERY_NAMESPACE, galleryMessages } from "@mustawfi/ui/gallery";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { startLocalRuntime } from "./local.ts";
import { SHELL_NAMESPACE, shellMessages } from "./messages.ts";
import { detectPlatform } from "./platform.ts";
import { PrintingProvider } from "./printing.tsx";
import { RECEIPT_FONT_SOURCES } from "./receipt-fonts.ts";
import { createAppRouter } from "./router.tsx";

/**
 * The composition root of the client — the browser app and the Windows app's page: the
 * platform, then each module with its own i18n namespace.
 */
const platform = detectPlatform();
configureApi(platform.api);

const i18n = createI18n({
  [SHELL_NAMESPACE]: shellMessages,
  [UI_NAMESPACE]: uiMessages,
  [GALLERY_NAMESPACE]: galleryMessages,
  [ACCESS_NAMESPACE]: accessMessages,
  [TENANCY_NAMESPACE]: tenancyMessages,
  [AUDIT_NAMESPACE]: auditMessages,
  [ORGANIZATION_NAMESPACE]: organizationMessages,
  [INVENTORY_NAMESPACE]: inventoryMessages,
  [SYNC_NAMESPACE]: syncMessages,
  [SALES_NAMESPACE]: salesMessages,
});
document.documentElement.lang = LANGUAGE;
document.documentElement.dir = DIRECTION;
document.title = i18n.t("mark", { ns: SHELL_NAMESPACE });

/**
 * A session that expired or was revoked elsewhere shows up as a 401 on any call: drop every
 * cached query (the cached session included) and go back to sign-in.
 */
function onApiError(error: Error): void {
  if (error instanceof ApiProblem && error.code === accessProblemCodes.sessionRequired) {
    queryClient.clear();
    void router.navigate({ to: "/login" });
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      retry: (failures, error) => !(error instanceof ApiProblem) && failures < 1,
    },
  },
});
const router = createAppRouter(queryClient, platform.deviceType);

const runtime = {
  clock: systemClock,
  newId: uuidV7Generator({ clock: systemClock, random: cryptoRandom }),
};

/**
 * The receipt font loads while the app starts, so a receipt printed later (offline too)
 * fetches nothing. It does not hold the app back: a receipt waits for it, or reports it failed.
 */
const receiptFonts = loadReceiptFonts(RECEIPT_FONT_SOURCES);
receiptFonts.catch((error: unknown) => {
  console.error("the receipt font did not load", error);
});

const element = document.getElementById("root");
if (element === null) throw new Error("index.html has no #root");
const root = createRoot(element);

/**
 * The local database opens before anything renders (ADR-0019): screens read it, and the POS
 * cannot sell without it. If it cannot open, the app says so instead of selling into nothing.
 */
const printerTransport = platform.openPrinter?.().catch((error: unknown) => {
  // Printing is optional: without its transport the app still sells, and only previews.
  console.error("the printer transport did not load", error);
  return undefined;
});

Promise.all([startLocalRuntime(queryClient, platform), printerTransport]).then(
  ([{ db, sync }, printer]) => {
    root.render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <LocaleProvider>
            <ClientRuntimeProvider runtime={runtime}>
              <LocalDbProvider db={db}>
                <SyncEngineProvider engine={sync}>
                  <PrintingProvider printing={{ fonts: receiptFonts, transport: printer }}>
                    <QueryClientProvider client={queryClient}>
                      <RouterProvider router={router} />
                    </QueryClientProvider>
                  </PrintingProvider>
                </SyncEngineProvider>
              </LocalDbProvider>
            </ClientRuntimeProvider>
          </LocaleProvider>
        </I18nextProvider>
      </StrictMode>,
    );
  },
  (error: unknown) => {
    console.error("the local database did not open", error);
    root.render(
      <StrictMode>
        <p role="alert" className="p-6 text-text-negative">
          {i18n.t("localDbUnavailable", { ns: SHELL_NAMESPACE })}
        </p>
      </StrictMode>,
    );
  },
);
