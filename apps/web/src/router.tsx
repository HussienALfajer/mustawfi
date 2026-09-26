import { type DeviceType, IDLE_LOCK_MS } from "@mustawfi/core-access/shared";
import {
  AccountScreen,
  beginDeviceSession,
  DeviceRemovedScreen,
  deviceFiltersSchema,
  DeviceScreen,
  DevicesScreen,
  localDeviceQueryOptions,
  lockDevice,
  LoginScreen,
  PasswordResetScreen,
  PinScreen,
  roleFiltersSchema,
  RolesScreen,
  type SignedIn,
  signedInQueryKey,
  signedInQueryOptions,
  sessionQueryOptions,
  signOut,
  useAutoLock,
  UserMenu,
  userFiltersSchema,
  UsersScreen,
} from "@mustawfi/core-access/client";
import {
  ApiProblem,
  ApiUnreachable,
  forgetSession,
  useClientRuntime,
} from "@mustawfi/core-config/client";
import {
  departmentFiltersSchema,
  DepartmentsScreen,
  departmentsQueryOptions,
  deviceLicenseQueryOptions,
  deviceLicenseRestriction,
  LicenseIndicator,
  type LicenseNotice,
  LicenseScreen,
  openDeviceLicenseDay,
  serverLicenseNotice,
  StoreProfileScreen,
  StoreSuspendedScreen,
  suspendedFor,
} from "@mustawfi/core-organization/client";
import { AuditLogScreen, auditLogFiltersSchema } from "@mustawfi/core-audit/client";
import type { DeviceLicenseAudit } from "@mustawfi/core-tenancy/client";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import type { LicenseLimitName } from "@mustawfi/core-organization/shared";
import { SyncStatusIndicator, useSyncEngine, useSyncStatus } from "@mustawfi/core-sync/client";
import { type LocalDb, useLocalDb } from "@mustawfi/local-db";
import { ProductsScreen } from "@mustawfi/inventory/client";
import { InvoicesScreen, PosScreen } from "@mustawfi/sales/client";
import { INVOICE_CREATE_PERMISSION } from "@mustawfi/sales/shared";
import {
  type NavGroup,
  SIDE_NAVIGATION_WIDTH,
  SideNavigation,
  useNavigationCollapsed,
} from "@mustawfi/ui";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  BadgeCheck,
  Laptop,
  Layers,
  MonitorSmartphone,
  Package,
  Printer,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Store,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { bundleVerifier } from "./bundle-verifier.ts";
import { SHELL_NAMESPACE } from "./messages.ts";
import { PrinterScreen, ReceiptActions } from "./printing.tsx";

export interface RouterContext {
  readonly queryClient: QueryClient;
  /** What this client registers as: the Windows app is the main POS (ADR-0022). */
  readonly deviceType: DeviceType;
  /** The local database, which says who is signed in on a registered device. */
  readonly db: LocalDb;
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

/**
 * Every page, unless this device was removed from its store: once a revoked device has sent
 * everything and wiped its data (`core-foundation` rule 23), the notice takes the whole window
 * until the user goes on — to registering this client again (sign-in first, if needed).
 */
function Root() {
  const phase = useSyncStatus().phase;
  const sync = useSyncEngine();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  if (phase !== "removed") return <Outlet />;
  return (
    <DeviceRemovedScreen
      onContinue={() => {
        // Nothing read before the wipe may show again: the session ended with the device.
        queryClient.clear();
        // Back to registering this client, after signing in again if its session ended.
        void sync.acknowledgeRemoval().then(() => navigate({ to: "/device" }));
      }}
    />
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Root,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

/** Who is signed in, cached for the guards; a sign-in or a lock removes it, so it is read again. */
function signedInOf(context: RouterContext): Promise<SignedIn | null> {
  return context.queryClient.ensureQueryData({
    ...signedInQueryOptions(context.db, bundleVerifier()),
    revalidateIfStale: true,
  });
}

function LoginPage() {
  const navigate = useNavigate();
  const db = useLocalDb();
  const { clock } = useClientRuntime();
  const queryClient = useQueryClient();
  const { reset } = loginRoute.useSearch();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-page p-4">
      <ProductMark />
      <LoginScreen
        passwordWasReset={reset === true}
        recoveryLink={(label) => (
          <Link to="/recover" className="text-text-accent underline">
            {label}
          </Link>
        )}
        onSignedIn={(session) => {
          // On a registered device of the user's store, they are now the one signed in on it.
          void beginDeviceSession(db, session, clock).then(() => {
            queryClient.removeQueries({ queryKey: signedInQueryKey });
            return navigate({ to: "/products" });
          });
        }}
      />
    </main>
  );
}

/** Only for signed-out visitors: a session goes straight to the app. */
async function signedOutOnly({ context }: { readonly context: RouterContext }) {
  let signedIn: SignedIn | null = null;
  try {
    signedIn = await signedInOf(context);
  } catch (error) {
    // Out of reach: signing in says so itself.
    if (!(error instanceof ApiUnreachable)) throw error;
  }
  if (signedIn !== null) redirect({ to: "/products", throw: true });
}

/** A path inside the app to return to, never another origin. */
const returnPathSchema = z.string().regex(/^\/(?![/\\])/);

function PinPage() {
  const navigate = useNavigate();
  const db = useLocalDb();
  const queryClient = useQueryClient();
  const { reconnect, redirect: returnTo } = pinRoute.useSearch();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-page p-4">
      <ProductMark />
      <PinScreen
        bundleVerifier={bundleVerifier()}
        reconnect={reconnect === true}
        passwordLink={(label) => (
          <Link to="/login" className="text-text-accent underline">
            {label}
          </Link>
        )}
        onSignedIn={() => {
          void navigate({ href: returnTo ?? "/pos" });
        }}
        onCancel={() => {
          void navigate({ to: "/pos" });
        }}
        onPasswordInstead={() => {
          void lockDevice(db).then(() => {
            queryClient.clear();
            return navigate({ to: "/login" });
          });
        }}
      />
    </main>
  );
}

/**
 * The PIN screen (flow 12) of a registered device: where it opens, and where auto-lock and a user
 * switch return. `reconnect` asks the user signed in without the server for their PIN to open a
 * server session (rule 25); `redirect` is where to go once signed in.
 */
const pinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pin",
  validateSearch: z.object({
    reconnect: z.boolean().optional().catch(undefined),
    redirect: returnPathSchema.optional().catch(undefined),
  }),
  beforeLoad: async ({ context, search }) => {
    const device = await context.queryClient.ensureQueryData(localDeviceQueryOptions(context.db));
    if (device === null) redirect({ to: "/login", throw: true });
    const signedIn = await signedInOf(context);
    if (search.reconnect === true) {
      if (signedIn?.device == null) redirect({ to: "/pin", throw: true });
      return;
    }
    if (signedIn !== null) redirect({ href: search.redirect ?? "/pos", throw: true });
  },
  component: PinPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // `reset` marks the return from a support reset (`core-foundation` rule 27).
  validateSearch: z.object({ reset: z.boolean().optional().catch(undefined) }),
  beforeLoad: signedOutOnly,
  component: LoginPage,
});

function RecoverPage() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-page p-4">
      <ProductMark />
      <PasswordResetScreen
        backLink={(label) => (
          <Link to="/login" className="text-text-accent underline">
            {label}
          </Link>
        )}
        onReset={() => {
          void navigate({ to: "/login", search: { reset: true } });
        }}
      />
    </main>
  );
}

/** Recovery with a support reset code (`core-foundation` rule 27), before sign-in. */
const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recover",
  beforeLoad: signedOutOnly,
  component: RecoverPage,
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
  | "/admin/users"
  | "/admin/roles"
  | "/admin/devices"
  | "/admin/license"
  | "/admin/audit"
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
        // Held in some department: a sale outside them asks a supervisor (rule 18).
        ...item("pos", "/pos", <ShoppingCart {...ICON_PROPS} />, INVOICE_CREATE_PERMISSION),
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
        ...item("users", "/admin/users", <Users {...ICON_PROPS} />, "access.users.view"),
        ...item("roles", "/admin/roles", <ShieldCheck {...ICON_PROPS} />, "access.users.view"),
        ...item("devices", "/admin/devices", <Laptop {...ICON_PROPS} />, "access.devices.manage"),
        ...item(
          "license",
          "/admin/license",
          <BadgeCheck {...ICON_PROPS} />,
          "organization.license.view",
        ),
        ...item("audit", "/admin/audit", <ScrollText {...ICON_PROPS} />, "audit.view"),
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

/** Who is signed in on this client (`SignedIn`); `undefined` while it loads. */
function useSignedIn(): SignedIn | null | undefined {
  return useQuery(signedInQueryOptions(useLocalDb(), bundleVerifier())).data;
}

/**
 * Who audits what the device's license readings notice (`core-foundation` rule 33): the user
 * signed in on this device, through the app's outbox sink — only on a device registered to that
 * user's store, so no event is queued under another store's user.
 */
function useDeviceLicenseAudit(): DeviceLicenseAudit | undefined {
  const { audit } = useClientRuntime();
  const signedIn = useSignedIn();
  const userId = signedIn?.device == null ? undefined : signedIn.user.id;
  return useMemo(
    () => (userId === undefined ? undefined : { sink: audit, userId }),
    [audit, userId],
  );
}

/**
 * The license as this client knows it (`core-foundation` rules 6–11): a device registered to the
 * signed-in store applies its own evaluation from the verified bundle; any other client (an
 * unregistered browser) shows the server's state. `undefined` while it loads.
 */
function useLicenseNotice(): LicenseNotice | undefined {
  const db = useLocalDb();
  const { clock } = useClientRuntime();
  const signedIn = useSignedIn();
  const audit = useDeviceLicenseAudit();
  const onDevice = signedIn?.device != null;
  const license = useQuery({
    ...deviceLicenseQueryOptions(db, bundleVerifier(), clock, audit),
    enabled: onDevice,
  }).data;
  if (signedIn === undefined || signedIn === null) return undefined;
  if (!onDevice) {
    return signedIn.server === null ? undefined : serverLicenseNotice(signedIn.server.license);
  }
  return license ?? undefined;
}

/**
 * Ends the session on this device and shows the PIN screen (rules 24–25): auto-lock returns to
 * where the user was, a user switch to the start. Nothing the previous user read stays cached,
 * and an unsaved administration form is left without asking: those screens work online and keep
 * nothing on the device.
 */
function useLockDevice(): (returnTo?: string) => Promise<void> {
  const db = useLocalDb();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async (returnTo) => {
    await lockDevice(db);
    // Before the PIN screen mounts: a query cleared under a mounted screen never answers it.
    queryClient.clear();
    await navigate({
      to: "/pin",
      search: returnTo === undefined ? {} : { redirect: returnTo },
      ignoreBlocker: true,
    });
  };
}

/**
 * «Store suspended» in place of the app (rule 9), with one action: signing out — or, on a
 * device of the store, switching user.
 */
function StoreSuspendedPage(props: {
  readonly standing?: LicenseNotice["standing"];
  readonly onDevice?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lock = useLockDevice();
  const leave = useMutation({
    mutationFn: async () => {
      if (props.onDevice === true) await lock();
      else await signOut();
    },
    onSettled: () => {
      if (props.onDevice === true) return;
      // Signed out even when the server could not be told (offline): the token is forgotten.
      forgetSession();
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });
  return (
    <StoreSuspendedScreen
      standing={props.standing}
      signingOut={leave.isPending}
      onSignOut={() => {
        leave.mutate();
      }}
    />
  );
}

/**
 * The frame (`screen-patterns.md`, approved on the preview 2026-09-25): the grouped side
 * navigation on the start side, collapsible with `Ctrl+B`; a top bar with the page title, the
 * license warning, the sync status, and the user; the page fills the rest. On a device of the
 * store, 5 minutes without input return to the PIN screen (rule 24).
 */
function AppShell() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const navigate = useNavigate();
  const db = useLocalDb();
  const { clock } = useClientRuntime();
  const signedIn = useSignedIn();
  const [collapsed, setCollapsed] = useNavigationCollapsed(NAVIGATION_STORAGE_KEY);
  // What the user holds somewhere, from the grant the device resolves as the server does.
  const permissions = useMemo(() => new Set(signedIn?.grant.permissions ?? []), [signedIn]);
  const groups = useNavigationGroups(permissions);
  const page = usePage();
  const notice = useLicenseNotice();
  const audit = useDeviceLicenseAudit();
  const lock = useLockDevice();
  const onDevice = signedIn?.device != null;
  // A session begins here — a sign-in (by PIN or password, each opening the device's session
  // anew), or the app opened with one: the device evaluates the license for the business day
  // when the day changed since (rule 6).
  const sessionStart = signedIn?.device?.openedAt ?? signedIn?.user.id;
  useEffect(() => {
    if (sessionStart === undefined) return;
    openDeviceLicenseDay(db, bundleVerifier(), clock, audit).catch((error: unknown) => {
      console.error("the license could not be evaluated on this device", error);
    });
  }, [db, clock, sessionStart, audit]);
  useAutoLock({
    db,
    clock,
    idleMs: IDLE_LOCK_MS,
    enabled: onDevice,
    onLock: () => {
      void lock(`${window.location.pathname}${window.location.search}`);
    },
  });
  if (signedIn === undefined || signedIn === null) return null;
  const isOwner = signedIn.user.role.isOwner;
  // Only owners come in while the store is suspended (rule 9).
  if (suspendedFor(notice, isOwner)) {
    return <StoreSuspendedPage standing={notice?.standing ?? null} onDevice={onDevice} />;
  }
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
            {notice === undefined ? null : (
              <LicenseIndicator
                notice={notice}
                isOwner={isOwner}
                {...(permissions.has("organization.license.view")
                  ? {
                      link: (content: ReactNode) => (
                        <Link to="/admin/license" className="underline">
                          {content}
                        </Link>
                      ),
                    }
                  : {})}
              />
            )}
            <SyncStatusIndicator />
            <UserMenu
              signedIn={signedIn}
              onAccount={() => {
                void navigate({ to: "/account" });
              }}
              onSignedOut={() => {
                void navigate({ to: "/login" });
              }}
              onSwitchUser={() => {
                void lock();
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

/** Whether the server turned the session away because the store is suspended (rule 5). */
function isSuspension(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === tenancyProblemCodes.licenseSuspended;
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    let signedIn;
    try {
      signedIn = await signedInOf(context);
    } catch (error) {
      // A non-owner's session while the store is suspended: the notice, not an error.
      if (isSuspension(error)) redirect({ to: "/suspended", throw: true });
      throw error;
    }
    if (signedIn !== null) return;
    // A registered device opens on its PIN screen (flow 12); any other client on sign-in.
    const device = await context.queryClient.ensureQueryData(localDeviceQueryOptions(context.db));
    redirect({ to: device === null ? "/login" : "/pin", throw: true });
  },
  component: AppShell,
});

/**
 * «Store suspended» for a session the server turns away (rule 9). Reached only then: a session it
 * accepts goes to the app, and no session to sign-in.
 */
const suspendedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/suspended",
  beforeLoad: async ({ context }) => {
    let session;
    try {
      session = await context.queryClient.fetchQuery(sessionQueryOptions());
    } catch (error) {
      if (isSuspension(error)) return;
      throw error;
    }
    redirect({ to: session === null ? "/login" : "/products", throw: true });
  },
  component: function SuspendedPage() {
    // On a registered device the one action ends its session too, back to the PIN screen.
    const device = useQuery(localDeviceQueryOptions(useLocalDb())).data;
    return <StoreSuspendedPage onDevice={device !== undefined && device !== null} />;
  },
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
  const db = useLocalDb();
  const { clock } = useClientRuntime();
  const signedIn = useSignedIn();
  const audit = useDeviceLicenseAudit();
  const license = useQuery(deviceLicenseQueryOptions(db, bundleVerifier(), clock, audit));
  if (signedIn === undefined || signedIn === null) return null;
  return (
    <PosScreen
      seller={{
        userId: signedIn.user.id,
        tenantId: signedIn.tenantId,
        departmentScope: signedIn.user.departmentScope,
        departments: signedIn.user.departments,
        can: (permission, departmentId) => signedIn.grant.can(permission, departmentId),
      }}
      bundleVerifier={bundleVerifier()}
      license={{
        notice: license.data ?? undefined,
        failed: license.isError,
        // Read again right before the sale is recorded (ADR-0021).
        check: () => deviceLicenseRestriction(db, bundleVerifier(), clock, audit),
      }}
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

function UsersPage() {
  const filters = usersRoute.useSearch();
  const navigate = usersRoute.useNavigate();
  // Departments come from `core.organization`; the users screen only reads them.
  const departments = useQuery(departmentsQueryOptions()).data;
  return (
    <UsersScreen
      filters={filters}
      departments={departments}
      onFiltersChange={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/users",
  staticData: { title: "pages.users", fill: true },
  validateSearch: userFiltersSchema,
  component: UsersPage,
});

function RolesPage() {
  const filters = rolesRoute.useSearch();
  const navigate = rolesRoute.useNavigate();
  return (
    <RolesScreen
      filters={filters}
      onFiltersChange={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}

const rolesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/roles",
  staticData: { title: "pages.roles", fill: true },
  validateSearch: roleFiltersSchema,
  component: RolesPage,
});

function DevicesPage() {
  const filters = devicesRoute.useSearch();
  const navigate = devicesRoute.useNavigate();
  // The device this client is, from its own database, marked in the list.
  const current = useQuery(localDeviceQueryOptions(useLocalDb())).data;
  const sync = useSyncEngine();
  return (
    <DevicesScreen
      filters={filters}
      currentDeviceId={current?.deviceId ?? null}
      onRevoked={(device) => {
        // This device was revoked: it sends what it holds and wipes now, not at the next tick.
        if (device.id === current?.deviceId) void sync.syncNow();
      }}
      onFiltersChange={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}

const devicesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/devices",
  staticData: { title: "pages.devices", fill: true },
  validateSearch: deviceFiltersSchema,
  component: DevicesPage,
});

function AuditLogPage() {
  const filters = auditLogRoute.useSearch();
  const navigate = auditLogRoute.useNavigate();
  return (
    <AuditLogScreen
      filters={filters}
      onFiltersChange={(next) => {
        void navigate({ search: next, replace: true });
      }}
    />
  );
}

const auditLogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/audit",
  staticData: { title: "pages.audit", fill: true },
  validateSearch: auditLogFiltersSchema,
  component: AuditLogPage,
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

/** Where each license limit is managed, and the permission that screen needs. */
const LIMIT_SCREENS: Record<
  LicenseLimitName,
  { readonly to: NavPath; readonly permission: string; readonly label: `licenseLinks.${string}` }
> = {
  users: { to: "/admin/users", permission: "access.users.view", label: "licenseLinks.users" },
  departments: {
    to: "/admin/departments",
    permission: "organization.departments.manage",
    label: "licenseLinks.departments",
  },
  mainPosDevices: {
    to: "/admin/devices",
    permission: "access.devices.manage",
    label: "licenseLinks.devices",
  },
  companionDevices: {
    to: "/admin/devices",
    permission: "access.devices.manage",
    label: "licenseLinks.devices",
  },
};

function LicensePage() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const permissions = new Set(useSignedIn()?.grant.permissions ?? []);
  return (
    <LicenseScreen
      limitLink={(limit) => {
        const screen = LIMIT_SCREENS[limit];
        return permissions.has(screen.permission) ? (
          <Link to={screen.to} className="text-text-accent underline">
            {t(screen.label)}
          </Link>
        ) : null;
      }}
    />
  );
}

/** «License and plan» (summary), for owners and holders of `organization.license.view`. */
const licenseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/license",
  staticData: { title: "pages.license", fill: true },
  component: LicensePage,
});

function DevicePage() {
  const { deviceType } = deviceRoute.useRouteContext();
  return <DeviceScreen deviceType={deviceType} bundleVerifier={bundleVerifier()} />;
}

const deviceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/device",
  staticData: { title: "pages.device" },
  component: DevicePage,
});

/** «My account» (`core-foundation` flow 11), from the top bar. */
const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/account",
  staticData: { title: "pages.account", fill: true },
  component: AccountScreen,
});

const printerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/printer",
  staticData: { title: "pages.printer" },
  component: PrinterScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  recoverRoute,
  pinRoute,
  galleryRoute,
  suspendedRoute,
  appRoute.addChildren([
    indexRoute,
    posRoute,
    productsRoute,
    invoicesRoute,
    departmentsRoute,
    usersRoute,
    rolesRoute,
    devicesRoute,
    auditLogRoute,
    storeProfileRoute,
    licenseRoute,
    deviceRoute,
    printerRoute,
    accountRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient, deviceType: DeviceType, db: LocalDb) {
  return createRouter({
    routeTree,
    context: { queryClient, deviceType, db },
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
