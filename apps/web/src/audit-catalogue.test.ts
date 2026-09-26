import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_DEVICE_AUDIT_ACTIONS } from "@mustawfi/core-access/shared";
import { auditLabelKey } from "@mustawfi/core-audit/client";
import { TENANCY_DEVICE_AUDIT_ACTIONS } from "@mustawfi/core-tenancy/shared";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { moduleMessage } from "./module-messages.ts";

/**
 * The audit catalogue (`core-foundation` rule 34, non-negotiable 10): every audit action code
 * the code writes, each with an Arabic label in its module's namespace and at least one writer,
 * and the events of non-negotiable 10 the `core-foundation` unit audits, each mapped to the
 * codes that record it.
 *
 * A writer is a string literal under an `action` key in a source file (`action: "…"`, a
 * conditional of literals included) — the way every module writes an audit entry, a device
 * event, or a table of them. An action built from a template, or set from a variable outside the
 * few files that only hand one on (`PASS_THROUGH`), cannot be found, so it fails the test; write
 * each code out whole.
 */

/** Every audit action code; `device` for the events recorded through the device audit path. */
const CATALOGUE: readonly { readonly action: string; readonly device?: true }[] = [
  { action: "access.device.registered" },
  { action: "access.device.revoked" },
  { action: "access.device.wiped" },
  { action: "access.login.failed" },
  { action: "access.login.succeeded" },
  { action: "access.login.throttled" },
  { action: "access.override.granted", device: true },
  { action: "access.override.refused", device: true },
  { action: "access.pin.failed", device: true },
  { action: "access.pin.lockedOut", device: true },
  { action: "access.pin.signedIn", device: true },
  { action: "access.pin.unlocked", device: true },
  { action: "access.registrationCode.issued" },
  { action: "access.resetCode.issued" },
  { action: "access.role.archived" },
  { action: "access.role.changed" },
  { action: "access.role.created" },
  { action: "access.session.revoked" },
  { action: "access.twoFactor.cleared" },
  { action: "access.twoFactor.disabled" },
  { action: "access.twoFactor.enabled" },
  { action: "access.twoFactor.recoveryCodeUsed" },
  { action: "access.user.changed" },
  { action: "access.user.created" },
  { action: "access.user.deactivated" },
  { action: "access.user.passwordChanged" },
  { action: "access.user.passwordReset" },
  { action: "access.user.passwordSet" },
  { action: "access.user.pinChanged" },
  { action: "access.user.pinSet" },
  { action: "access.user.reactivated" },
  { action: "access.user.roleChanged" },
  { action: "access.user.scopeChanged" },
  { action: "inventory.product.created" },
  { action: "ledger.accounts.seeded" },
  { action: "organization.department.archived" },
  { action: "organization.department.created" },
  { action: "organization.department.renamed" },
  { action: "organization.numbering.gap" },
  { action: "organization.profile.changed" },
  { action: "organization.profile.created" },
  { action: "sales.invoice.created" },
  { action: "tenancy.clock.movedBack", device: true },
  { action: "tenancy.clock.wrong", device: true },
  { action: "tenancy.license.installed" },
  { action: "tenancy.license.offlineTooLong", device: true },
  { action: "tenancy.license.readOnlyReached", device: true },
  { action: "tenancy.license.suspendedReached", device: true },
  { action: "tenancy.tenant.created" },
];

/** The device events the server accepts, from the modules' own declarations. */
const DEVICE_AUDIT_ACTIONS = new Set([
  ...TENANCY_DEVICE_AUDIT_ACTIONS,
  ...ACCESS_DEVICE_AUDIT_ACTIONS,
]);

/**
 * The events of non-negotiable 10 that `core-foundation` audits (its spec's list), each with the
 * codes that record it — or the slice that will write it, or why it is not audited.
 */
const UNIT_EVENTS: readonly (
  | { readonly event: string; readonly actions: readonly string[] }
  | { readonly event: string; readonly pending: string }
  | { readonly event: string; readonly notAudited: string }
)[] = [
  {
    event: "sign-in by password or PIN: success, failure, throttled",
    actions: [
      "access.login.succeeded",
      "access.login.failed",
      "access.login.throttled",
      "access.pin.signedIn",
      "access.pin.failed",
    ],
  },
  { event: "sign-out", actions: ["access.session.revoked"] },
  { event: "lockout and unlock", actions: ["access.pin.lockedOut", "access.pin.unlocked"] },
  { event: "auto-lock", notAudited: "too frequent; the next sign-in is audited" },
  { event: "session revoked", actions: ["access.session.revoked"] },
  { event: "user created", actions: ["access.user.created"] },
  { event: "user edited", actions: ["access.user.changed"] },
  { event: "user deactivated", actions: ["access.user.deactivated"] },
  { event: "user reactivated", actions: ["access.user.reactivated"] },
  { event: "role changed", actions: ["access.user.roleChanged"] },
  { event: "scope changed", actions: ["access.user.scopeChanged"] },
  { event: "PIN set or changed", actions: ["access.user.pinSet", "access.user.pinChanged"] },
  {
    event: "password set, changed, or reset (support or owner)",
    actions: [
      "access.user.passwordSet",
      "access.user.passwordChanged",
      "access.user.passwordReset",
    ],
  },
  {
    event: "2FA enabled, disabled, cleared, recovery code used",
    actions: [
      "access.twoFactor.enabled",
      "access.twoFactor.disabled",
      "access.twoFactor.cleared",
      "access.twoFactor.recoveryCodeUsed",
    ],
  },
  {
    event: "role created, edited, archived",
    actions: ["access.role.created", "access.role.changed", "access.role.archived"],
  },
  {
    event: "device registered, revoked, wiped, registration code issued",
    actions: [
      "access.device.registered",
      "access.device.revoked",
      "access.device.wiped",
      "access.registrationCode.issued",
    ],
  },
  { event: "support reset code issued", actions: ["access.resetCode.issued"] },
  {
    event: "store profile changed (before/after)",
    actions: ["organization.profile.created", "organization.profile.changed"],
  },
  {
    event: "department created, renamed, archived",
    actions: [
      "organization.department.created",
      "organization.department.renamed",
      "organization.department.archived",
    ],
  },
  { event: "license installed", actions: ["tenancy.license.installed"] },
  {
    event: "license state reached on a device (read-only, suspended)",
    actions: ["tenancy.license.readOnlyReached", "tenancy.license.suspendedReached"],
  },
  { event: "maximum offline days reached", actions: ["tenancy.license.offlineTooLong"] },
  { event: "clock moved backwards", actions: ["tenancy.clock.movedBack"] },
  {
    event: "supervisor override granted or refused",
    actions: ["access.override.granted", "access.override.refused"],
  },
  { event: "number gap", actions: ["organization.numbering.gap"] },
];

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Where source code lives; tests, e2e journeys, and the simulation are not writers. */
const SOURCE_DIRS = ["core", "modules", "apps/server/src", "apps/web/src", "tools"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "target", "e2e", "sync-sim", "migrations"]);
/** What `auditActionSchema` accepts: `module.event` or deeper. */
const ACTION_CODE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/**
 * The files that hand an action on without naming it — the log itself, the device path, and
 * the tables of written-out codes they read — each with why. An `action` any other file sets
 * from a variable fails the test: its code would escape the catalogue.
 */
const PASS_THROUGH: Readonly<Record<string, string>> = {
  "core/audit/src/server/audit.ts": "recordAudit writes the action it is given",
  "core/audit/src/server/schema.ts": "declares the action column; writes nothing",
  "core/sync/src/shared/index.ts":
    "declares the device event payload's action field; writes nothing",
  "core/access/src/server/users.ts": "auditAs writes the action its callers name",
  "core/sync/src/server/audit-entries.ts": "records the device event's action once it is declared",
  "core/sync/src/client/audit-sink.ts": "queues the action its caller names",
  "core/organization/src/server/departments.ts": "reads DEPARTMENT_AUDIT, written out whole",
  "core/tenancy/src/client/device-license.ts": "reads DEVICE_LICENSE_EVENTS, written out whole",
  "core/access/src/client/pin/local-sign-in.ts": "reads PIN_DEVICE_EVENTS, written out whole",
  "core/access/src/client/pin/override.ts": "reads OVERRIDE_DEVICE_EVENTS, written out whole",
  // The audit log's reader (slice 17): filters and views name an action; none writes one.
  "core/audit/src/shared/index.ts": "declares the log's filter and view schemas; writes nothing",
  "core/audit/src/server/entries.ts": "reads the log for the viewer; writes nothing",
  "core/audit/src/client/log/queries.ts": "passes the action filter to the API; writes nothing",
  "core/audit/src/client/log/audit-log-screen.tsx": "filters and shows actions; writes nothing",
};

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...sourceFiles(join(dir, entry.name)));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|test-helpers)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

interface Scan {
  /** Each code written, with where (`path:line`). */
  readonly writers: ReadonlyMap<string, readonly string[]>;
  /** Actions built from a template, which the catalogue cannot see. */
  readonly templated: readonly string[];
  /** Actions set from a variable (`path:line`), allowed only in `PASS_THROUGH` files. */
  readonly passedOn: readonly string[];
}

function scan(): Scan {
  const writers = new Map<string, string[]>();
  const templated: string[] = [];
  const passedOn: string[] = [];
  for (const file of SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
    const where = (node: ts.Node) =>
      `${relative(ROOT, file).split(sep).join("/")}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`;
    const collect = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (ACTION_CODE.test(node.text)) {
          writers.set(node.text, [...(writers.get(node.text) ?? []), where(node)]);
        }
      } else if (ts.isTemplateExpression(node)) {
        templated.push(where(node));
      } else if (ts.isConditionalExpression(node)) {
        collect(node.whenTrue);
        collect(node.whenFalse);
      } else if (ts.isParenthesizedExpression(node)) {
        collect(node.expression);
      } else {
        passedOn.push(where(node));
      }
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        node.name.text === "action"
      ) {
        collect(node.initializer);
      } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "action") {
        passedOn.push(where(node));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { writers, templated, passedOn };
}

const { writers, templated, passedOn } = scan();
const catalogued = new Set(CATALOGUE.map((entry) => entry.action));

describe("the audit catalogue", () => {
  it("lists every action code the code writes", () => {
    const unlisted = [...writers.keys()].filter((action) => !catalogued.has(action));
    expect(unlisted, "add each to CATALOGUE with its Arabic label").toEqual([]);
    expect(templated, "write each audit action out whole").toEqual([]);
    const hidden = passedOn.filter((site) => !(site.replace(/:\d+$/, "") in PASS_THROUGH));
    expect(hidden, "name the action as a literal, or add the file to PASS_THROUGH").toEqual([]);
  });

  it("finds a writer for every listed code", () => {
    expect(CATALOGUE.filter((entry) => !writers.has(entry.action))).toEqual([]);
  });

  it("gives every listed code an Arabic label in its module's namespace", () => {
    const missing = CATALOGUE.map((entry) => auditLabelKey(entry.action)).filter((label) => {
      const text = moduleMessage(label.ns, label.key);
      return typeof text !== "string" || !/[؀-ۿ]/.test(text);
    });
    expect(missing).toEqual([]);
  });

  it("lists as device events exactly the events the modules send through the device path", () => {
    const device = CATALOGUE.filter((entry) => entry.device === true).map((entry) => entry.action);
    expect(device.sort()).toEqual([...DEVICE_AUDIT_ACTIONS].sort());
  });

  it("maps every event of non-negotiable 10 in the unit to written codes, or says why not", () => {
    const unmapped = UNIT_EVENTS.flatMap((entry) =>
      "actions" in entry
        ? entry.actions
            .filter((action) => !catalogued.has(action) || !writers.has(action))
            .map((action) => `${entry.event}: ${action}`)
        : [],
    );
    expect(unmapped).toEqual([]);
    for (const entry of UNIT_EVENTS) {
      if ("actions" in entry) expect(entry.actions.length, entry.event).toBeGreaterThan(0);
    }
  });

  it("maps an action to its module's namespace and key", () => {
    expect(auditLabelKey("tenancy.license.installed")).toEqual({
      ns: "tenancy",
      key: "audit.license.installed",
    });
    expect(auditLabelKey("ledger.accounts.seeded")).toEqual({
      ns: "ledger",
      key: "audit.accounts.seeded",
    });
  });
});
