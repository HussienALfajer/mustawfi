import type { DeviceType } from "@mustawfi/core-access/shared";
import {
  DeviceScreen,
  LoginScreen,
  sessionQueryOptions,
  SignOutButton,
} from "@mustawfi/core-access/client";
import {
  departmentFiltersSchema,
  DepartmentsScreen,
  StoreProfileScreen,
} from "@mustawfi/core-organization/client";
import { SyncStatusIndicator } from "@mustawfi/core-sync/client";
import { ProductsScreen } from "@mustawfi/inventory/client";
import { InvoicesScreen, PosScreen } from "@mustawfi/sales/client";
import {
  type NavGroup,
  SIDE_NAVIGATION_WIDTH,
  SideNavigation,
  useNavigationCollapsed,
} from "@mustawfi/ui";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  lazyRouteComponent,
  Outlet,
  redirect,
  useBlocker,
  useMatches,
  useNavigate,
} from "@tanstack/react-router";
import {
  Layers,
  MonitorSmartphone,
  Package,
  Printer,
  ReceiptText,
  ShoppingCart,
  Store,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SHELL_NAMESPACE } from "./messages.ts";
import { PrinterScreen, ReceiptActions } from "./printing.tsx";

export interface RouterContext {
  readonly queryClient: QueryClient;
  /** What this client registers as: the Windows app is the main POS (ADR-0022). */
  readonly deviceType: DeviceType;
}

/** A page's place in the frame: its title (a `shell` key), and whether it fills the content area. */
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    readonly title?: `pages.${string}`;
    /** List and settings screens fill the content area; older screens sit in a padded column. */
    readonly fill?: boolean;
  }
}

/** Where the side navigation's collapsed state is remembered on this device. */
const NAVIGATION_STORAGE_KEY = "mustawfi.navigation";

const ICON_PROPS = { size: 20, strokeWidth: 1.75 } as const;

function ProductMark() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  return (
    <div className="flex items-baseline gap-2">
      <span className="border-b-4 border-double border-signature text-xl font-bold text-text">
        {t("mark")}
      </span>
      <span className="text-xs whitespace-nowrap text-text-secondary">{t("vendor")}</span>
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

/** The component gallery: a review tool, open without a session (`screen-patterns.md`). */
const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gallery",
  component: lazyRouteComponent(() => import("./gallery.tsx"), "GalleryPage"),
});

type NavPath =
  | "/pos"
  | "/invoices"
  | "/products"
  | "/admin/profile"
  | "/admin/departments"
  | "/device"
  | "/printer";

function navLink(to: NavPath) {
  return function NavLink({
    className,
    children,
  }: {
    readonly className: string;
    readonly children: ReactNode;
  }) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  };
}

/**
 * The side navigation's groups. An entry appears only when the user's role holds the
 * permission its screen needs (`core-foundation` slice 5); a group left empty is not shown.
 */
function useNavigationGroups(permissions: ReadonlySet<string>): NavGroup[] {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const item = (id: string, to: NavPath, icon: ReactNode, permission?: string) =>
    permission === undefined || permissions.has(permission)
      ? [{ id, label: t(`nav.${id}`), icon, link: navLink(to) }]
      : [];
  const groups: NavGroup[] = [
    {
      id: "sales",
      label: t("nav.group.sales"),
      items: [
        ...item("pos", "/pos", <ShoppingCart {...ICON_PROPS} />),
        ...item("invoices", "/invoices", <ReceiptText {...ICON_PROPS} />, "sales.invoices.view"),
      ],
    },
    {
      id: "inventory",
      label: t("nav.group.inventory"),
      items: item("products", "/products", <Package {...ICON_PROPS} />, "inventory.products.view"),
    },
    {
      id: "administration",
      label: t("nav.group.administration"),
      items: [
        ...item(
          "profile",
          "/admin/profile",
          <Store {...ICON_PROPS} />,
          "organization.profile.edit",
        ),
        ...item(
          "departments",
          "/admin/departments",
          <Layers {...ICON_PROPS} />,
          "organization.departments.manage",
        ),
      ],
    },
    {
      id: "device",
      label: t("nav.group.device"),
      items: [
        ...item("device", "/device", <MonitorSmartphone {...ICON_PROPS} />),
        ...item("printer", "/printer", <Printer {...ICON_PROPS} />),
      ],
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** The page title and layout of the deepest matched route. */
function usePage() {
  const matches = useMatches();
  const page = [...matches].reverse().find((match) => match.staticData.title !== undefined);
  return { title: page?.staticData.title, fill: page?.staticData.fill === true };
}

/**
 * The frame (`screen-patterns.md`, approved on the preview 2026-09-25): the grouped side
 * navigation on the start side, collapsible with `Ctrl+B`; a top bar with the page title, the
 * sync status, and the user; the page fills the rest.
 */
function AppShell() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const navigate = useNavigate();
  const session = useQuery(sessionQueryOptions()).data;
  const [collapsed, setCollapsed] = useNavigationCollapsed(NAVIGATION_STORAGE_KEY);
  const permissions = useMemo(() => new Set(session?.user.permissions ?? []), [session]);
  const groups = useNavigationGroups(permissions);
  const page = usePage();
  return (
    <div
      className="grid h-screen bg-page text-text transition-[grid-template-columns]"
      style={{
        gridTemplateColumns: `${collapsed ? SIDE_NAVIGATION_WIDTH.collapsed : SIDE_NAVIGATION_WIDTH.expanded} minmax(0, 1fr)`,
      }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-2 focus:text-text-accent"
      >
        {t("skipToContent")}
      </a>
      <SideNavigation
        label={t("nav.label")}
        brand={<ProductMark />}
        collapsedBrand={
          <span className="border-b-4 border-double border-signature text-xl font-bold">
            {t("markInitial")}
          </span>
        }
        groups={groups}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        collapseLabel={t("nav.collapse")}
        expandLabel={t("nav.expand")}
      />
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-14 items-center gap-4 border-b border-divider bg-surface px-6">
          <h1 className="text-xl font-bold">{page.title === undefined ? null : t(page.title)}</h1>
          <div className="ms-auto flex items-center gap-3">
            <SyncStatusIndicator />
            {session ? (
              <span className="flex flex-col text-sm leading-tight">
                <span className="text-text">{session.user.name}</span>
                <span className="text-xs text-text-secondary">{session.user.role.name}</span>
              </span>
            ) : null}
            <SignOutButton
              onSignedOut={() => {
                void navigate({ to: "/login" });
              }}
            />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-auto">
          {page.fill ? (
            <Outlet />
          ) : (
            <div className="w-full max-w-6xl p-6">
              <Outlet />
            </div>
          )}
        </main>
      </div>
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
  staticData: { title: "pages.products" },
  component: ProductsScreen,
});

function PosPage() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const session = useQuery(sessionQueryOptions()).data;
  if (session === undefined || session === null) return null;
  return (
    <PosScreen
      seller={{ userId: session.user.id, tenantId: session.tenantId }}
      registerDeviceLink={
        <Link to="/device" className="text-text-accent underline">
          {t("registerDevice")}
        </Link>
      }
      receiptAction={(invoice) => <ReceiptActions invoice={invoice} />}
    />
  );
}

const posRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/pos",
  staticData: { title: "pages.pos" },
  component: PosPage,
});

const invoicesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/invoices",
  staticData: { title: "pages.invoices" },
  component: InvoicesScreen,
});

function DepartmentsPage() {
  const filters = departmentsRoute.useSearch();
  const navigate = departmentsRoute.useNavigate();
  return (
    <DepartmentsScreen
      filters={filters}
      onFiltersChange={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}

const departmentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/departments",
  staticData: { title: "pages.departments", fill: true },
  validateSearch: departmentFiltersSchema,
  component: DepartmentsPage,
});

function StoreProfilePage() {
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return (
    <StoreProfileScreen
      onDirtyChange={setDirty}
      leave={
        blocker.status === "blocked" ? { proceed: blocker.proceed, stay: blocker.reset } : undefined
      }
    />
  );
}

const storeProfileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/profile",
  staticData: { title: "pages.profile", fill: true },
  component: StoreProfilePage,
});

function DevicePage() {
  const { deviceType } = deviceRoute.useRouteContext();
  return <DeviceScreen deviceType={deviceType} />;
}

const deviceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/device",
  staticData: { title: "pages.device" },
  component: DevicePage,
});

const printerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/printer",
  staticData: { title: "pages.printer" },
  component: PrinterScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  galleryRoute,
  appRoute.addChildren([
    indexRoute,
    posRoute,
    productsRoute,
    invoicesRoute,
    departmentsRoute,
    storeProfileRoute,
    deviceRoute,
    printerRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient, deviceType: DeviceType) {
  return createRouter({
    routeTree,
    context: { queryClient, deviceType },
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
