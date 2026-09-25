import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { ACCESS_NAMESPACE, accessMessages } from "@mustawfi/core-access/client";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ApiProblem, ClientRuntimeProvider, configureApi } from "@mustawfi/core-config/client";
import { SYNC_NAMESPACE, SyncEngineProvider, syncMessages } from "@mustawfi/core-sync/client";
import { createI18n, DIRECTION, LANGUAGE } from "@mustawfi/i18n";
import { INVENTORY_NAMESPACE, inventoryMessages } from "@mustawfi/inventory/client";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { LocalDbProvider } from "@mustawfi/local-db";
import { SALES_NAMESPACE, salesMessages } from "@mustawfi/sales/client";
import { LocaleProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { startLocalRuntime } from "./local.ts";
import { SHELL_NAMESPACE, shellMessages } from "./messages.ts";
import { detectPlatform } from "./platform.ts";
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
  [ACCESS_NAMESPACE]: accessMessages,
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

const element = document.getElementById("root");
if (element === null) throw new Error("index.html has no #root");
const root = createRoot(element);

/**
 * The local database opens before anything renders (ADR-0019): screens read it, and the POS
 * cannot sell without it. If it cannot open, the app says so instead of selling into nothing.
 */
startLocalRuntime(queryClient, platform).then(
  ({ db, sync }) => {
    root.render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <LocaleProvider>
            <ClientRuntimeProvider runtime={runtime}>
              <LocalDbProvider db={db}>
                <SyncEngineProvider engine={sync}>
                  <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                  </QueryClientProvider>
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
