/**
 * Where an audit action's Arabic label lives (`core-foundation` rule 34): in the writing module's
 * own i18n namespace, which is the action's first segment, under `audit.` and the rest of it —
 * `tenancy.license.installed` → `tenancy:audit.license.installed`.
 */
export function auditLabelKey(action: string): { readonly ns: string; readonly key: string } {
  const [ns = action, ...rest] = action.split(".");
  return { ns, key: `audit.${rest.join(".")}` };
}
