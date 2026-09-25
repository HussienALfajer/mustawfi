/**
 * Where a permission's or limit's Arabic label lives: in the declaring module's own i18n
 * namespace, which is the id's first segment (`audit.view` is `core.audit`'s, namespace
 * `audit`), under `permission.` or `limit.` and the rest of the id. A module's name over its
 * group in the permission matrix is `moduleName` in the same namespace.
 */
export interface LabelKey {
  readonly ns: string;
  readonly key: string;
}

function labelKey(kind: "permission" | "limit", id: string): LabelKey {
  const [ns = id, ...rest] = id.split(".");
  return { ns, key: `${kind}.${rest.join(".")}` };
}

/** `access.users.view` → `access:permission.users.view`. */
export function permissionLabelKey(id: string): LabelKey {
  return labelKey("permission", id);
}

/** `sales.discount.maxPercent` → `sales:limit.discount.maxPercent`. */
export function limitLabelKey(id: string): LabelKey {
  return labelKey("limit", id);
}

/** A module's namespace: its id without `core.` (`core.access` → `access`). */
export function moduleNamespace(moduleId: string): string {
  return moduleId.replace(/^core\./, "");
}
