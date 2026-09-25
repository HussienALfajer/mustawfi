import { LoginScreen, sessionQueryOptions, SignOutButton } from "@mustawfi/core-access/client";
import { ProductsScreen } from "@mustawfi/inventory/client";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SHELL_NAMESPACE } from "./messages.ts";

export interface RouterContext {
  readonly queryClient: QueryClient;
}

function ProductMark() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  return (
    <div className="flex items-baseline gap-2">
      <span className="border-b-4 border-double border-signature text-xl font-bold text-text">
        {t("mark")}
      </span>
      <span className="text-xs text-text-secondary">{t("vendor")}</span>
    </div>
  );
}

function RouteError() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  return (
    <p role="alert" className="p-6 text-text-negative">
      {t("sessionFailed")}
    </p>
  );
}

function NotFound() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  return (
    <div className="flex flex-col gap-3 p-6">
      <p className="text-text">{t("notFound")}</p>
      <Link to="/products" className="text-text-accent underline">
        {t("home")}
      </Link>
    </div>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

function LoginPage() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-page p-4">
      <ProductMark />
      <LoginScreen
        onSignedIn={() => {
          void navigate({ to: "/products" });
        }}
      />
    </main>
  );
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (session !== null) redirect({ to: "/products", throw: true });
  },
  component: LoginPage,
});

function AppShell() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const navigate = useNavigate();
  const session = useQuery(sessionQueryOptions()).data;
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:bg-surface focus:p-2 focus:text-text-accent"
      >
        {t("skipToContent")}
      </a>
      <header className="flex items-center justify-between gap-4 border-b border-divider bg-surface px-6 py-3">
        <div className="flex items-center gap-8">
          <ProductMark />
          <nav aria-label={t("nav.label")}>
            <Link
              to="/products"
              className="text-text-secondary data-[status=active]:font-semibold data-[status=active]:text-text-accent"
            >
              {t("nav.products")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {session ? (
            <span className="text-sm text-text-secondary">
              {t("signedInAs", { name: session.user.name })}
            </span>
          ) : null}
          <SignOutButton
            onSignedOut={() => {
              void navigate({ to: "/login" });
            }}
          />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions());
    if (session === null) redirect({ to: "/login", throw: true });
  },
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: () => {
    redirect({ to: "/products", throw: true });
  },
});

const productsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/products",
  component: ProductsScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, productsRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
