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
import { ApiProblem } from "@mustawfi/core-config/client";
import { createI18n, DIRECTION, LANGUAGE } from "@mustawfi/i18n";
import { INVENTORY_NAMESPACE, inventoryMessages } from "@mustawfi/inventory/client";
import { LocaleProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { SHELL_NAMESPACE, shellMessages } from "./messages.ts";
import { createAppRouter } from "./router.tsx";

/** The composition root of the web client: each module brings its own i18n namespace. */
const i18n = createI18n({
  [SHELL_NAMESPACE]: shellMessages,
  [UI_NAMESPACE]: uiMessages,
  [ACCESS_NAMESPACE]: accessMessages,
  [INVENTORY_NAMESPACE]: inventoryMessages,
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
const router = createAppRouter(queryClient);

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LocaleProvider>
    </I18nextProvider>
  </StrictMode>,
);
