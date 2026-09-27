import { INVOICE_CREATE_PERMISSION } from "@mustawfi/sales/shared";

/** The screens of the side navigation, in its order. */
export type NavPath =
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

export interface Screen {
  /** Its title in the top bar (a `shell` key). */
  readonly title: `pages.${string}`;
  /** The permission it needs, `null` for every signed-in user. */
  readonly permission: string | null;
}

/**
 * The navigation's screens with the permission each needs: the side navigation shows an entry
 * only to users who hold it (`core-foundation` slice 5), and a screen opened by its address
 * without it shows that the role does not allow it (`ScreenNotAllowed`) — what the role never
 * allows is not shown (`screen-patterns.md`). The server refuses the same (rule 17).
 */
export const SCREENS: Readonly<Record<NavPath, Screen>> = {
  // Held in some department. The point of sale itself stays open to every user, as the
  // navigation does not offer it: a sale beyond the user's permission asks a supervisor (rule 18).
  "/pos": { title: "pages.pos", permission: INVOICE_CREATE_PERMISSION },
  "/invoices": { title: "pages.invoices", permission: "sales.invoices.view" },
  "/products": { title: "pages.products", permission: "inventory.products.view" },
  "/admin/profile": { title: "pages.profile", permission: "organization.profile.edit" },
  "/admin/departments": {
    title: "pages.departments",
    permission: "organization.departments.manage",
  },
  "/admin/users": { title: "pages.users", permission: "access.users.view" },
  "/admin/roles": { title: "pages.roles", permission: "access.users.view" },
  "/admin/devices": { title: "pages.devices", permission: "access.devices.manage" },
  "/admin/license": { title: "pages.license", permission: "organization.license.view" },
  "/admin/audit": { title: "pages.audit", permission: "audit.view" },
  "/device": { title: "pages.device", permission: null },
  "/printer": { title: "pages.printer", permission: null },
};

/** Whether a user holding `permissions` (somewhere) may open `screen`. */
export function mayOpen(screen: NavPath, permissions: ReadonlySet<string>): boolean {
  const { permission } = SCREENS[screen];
  return permission === null || permissions.has(permission);
}

/**
 * Where a signed-in user starts: the products, as ever, when they may open them; otherwise the
 * first screen of the navigation they may open. «This device» is open to everyone.
 */
export function startScreen(permissions: ReadonlySet<string>): NavPath {
  if (mayOpen("/products", permissions)) return "/products";
  const screens = Object.keys(SCREENS) as NavPath[];
  return screens.find((screen) => mayOpen(screen, permissions)) ?? "/device";
}

/**
 * The page data of a route that is `screen` and guarded by its permission: its title, and the
 * screen the frame checks before showing it.
 */
export function guardedPage(screen: NavPath): {
  readonly title: `pages.${string}`;
  readonly screen: NavPath;
} {
  return { title: SCREENS[screen].title, screen };
}
