/**
 * Where an audit action's Arabic label lives (`core-foundation` rule 34): in the writing module's
 * own i18n namespace, which is the action's first segment, under `audit.` and the rest of it —
 * `tenancy.license.installed` → `tenancy:audit.license.installed`.
 */
export function auditLabelKey(action: string): { readonly ns: string; readonly key: string } {
  const [ns = action, ...rest] = action.split(".");
  return { ns, key: `audit.${rest.join(".")}` };
}

/**
 * Where the label of one reason of an action lives, when the entry records one as `after.reason`
 * (`core-foundation` slice 20: `access.session.revoked` for a sign-out, a switched user, a
 * deactivated user…): beside the action's own, under `For.` and the reason —
 * `access:audit.session.revokedFor.signedOut`. `undefined` when the entry names no reason; an
 * entry whose reason has no label falls back to the action's.
 */
export function auditVariantLabelKey(
  action: string,
  after: Readonly<Record<string, unknown>> | null | undefined,
): { readonly ns: string; readonly key: string } | undefined {
  const reason = after?.["reason"];
  if (typeof reason !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(reason)) return undefined;
  const { ns, key } = auditLabelKey(action);
  return { ns, key: `${key}For.${reason}` };
}
