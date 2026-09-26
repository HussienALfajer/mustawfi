import type { LoadedBundle, VerifiedBundle } from "@mustawfi/core-config/client";
import type { Clock } from "@mustawfi/kernel";
import {
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
  safeInteger,
} from "@mustawfi/local-db";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  businessDate,
  LICENSE_BUNDLE_PART,
  LICENSE_STATES,
  type LicenseStanding,
  licenseStanding,
  type LicenseState,
  licenseState,
  type VerifiedLicense,
} from "../shared/index.ts";

/**
 * The license on the device (ADR-0021, ADR-0030, `core-foundation` rules 6–11): the clock guard
 * keeps a high-water mark of the local times the device has seen and the offset of its clock from
 * the last signed server time, and the day's state is evaluated at the first sign-in of each
 * business day and held until a sign-in on a later one. Both live in the local database, so a
 * restart changes nothing.
 *
 * The device's time for the license (its state and the offline days) is the last server time plus
 * the local time elapsed since, counted on the monotonic mark: neither a clock moved back nor a
 * clock that is simply wrong changes it (ADR-0021 amendment of 2026-09-26).
 */

/** How far behind the high-water mark the local clock may be before it counts as moved back. */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

/**
 * How far the local clock may be from the server's at the last server time: beyond it, documents
 * would carry a wrong date or time (a clock reset to 2009 by a dead battery, a wrong time zone),
 * so the device makes none until the clock is set right. A clock a few minutes off still sells.
 */
export const CLOCK_SKEW_LIMIT_MS = 30 * 60_000;

/**
 * How far the mark must move before it is written again: every read observes the clock, and a
 * write per read would wake every query reading the guard. The guard stays within the tolerance.
 */
const MARK_WRITE_STEP_MS = 60_000;

const MS_PER_DAY = 86_400_000;

/** The clock guard (ADR-0021): at most one row. */
const clockGuard = sqliteTable("tenancy_clock_guard", {
  id: integer().primaryKey(),
  /** The latest local time seen since the last server time, in epoch milliseconds. */
  highWaterMark: safeInteger("high_water_mark").notNull(),
  /** The last trusted server time taken, in epoch milliseconds: the last server contact. */
  serverTime: safeInteger("server_time"),
  /** The local clock when that server time was taken: its offset from the server's. */
  localAtServerTime: safeInteger("local_at_server_time"),
  /** When the local clock was found behind the mark; read-only until the server is reached. */
  behindSince: safeInteger("behind_since"),
});

/** The state held for the business day (rule 6): at most one row. */
const licenseDay = sqliteTable("tenancy_license_day", {
  id: integer().primaryKey(),
  /** The business date (`YYYY-MM-DD`, Damascus) of the sign-in that evaluated it. */
  businessDate: text("business_date").notNull(),
  state: text().notNull(),
  /** The `issuedAt` of the license it was evaluated with: a later one may lift it at once. */
  licenseIssuedAt: text("license_issued_at").notNull(),
  /** The last server contact was more than the license's maximum offline days ago (rule 7). */
  offlineExceeded: integer("offline_exceeded", { mode: "boolean" }).notNull(),
  /** The device's time it was evaluated at, in epoch milliseconds. */
  evaluatedAt: safeInteger("evaluated_at").notNull(),
});

export const CLOCK_GUARD_TABLE = "tenancy_clock_guard";
export const LICENSE_DAY_TABLE = "tenancy_license_day";

/** `core.tenancy`'s local schema (ADR-0019). */
export const tenancyLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.tenancy.0001_license_guard",
    statements: [
      `CREATE TABLE tenancy_clock_guard (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        high_water_mark INTEGER NOT NULL,
        server_time INTEGER,
        local_at_server_time INTEGER,
        behind_since INTEGER,
        CHECK ((server_time IS NULL) = (local_at_server_time IS NULL))
      ) STRICT`,
      `CREATE TABLE tenancy_license_day (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        business_date TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'expiring', 'grace', 'readOnly', 'suspended')),
        license_issued_at TEXT NOT NULL,
        offline_exceeded INTEGER NOT NULL CHECK (offline_exceeded IN (0, 1)),
        evaluated_at INTEGER NOT NULL
      ) STRICT`,
    ],
  },
];

/**
 * Why this device may not create a document now (rule 9: no new document of any kind):
 * - `suspended`, `readOnly`: the license's state held for the day;
 * - `clockBehind`: the clock was moved back (rule 8), until the server is reached;
 * - `clockWrong`: the clock was more than `CLOCK_SKEW_LIMIT_MS` from the server's at the last
 *   server time, until a server time finds it right;
 * - `bundleRefused`: the last bundle offered, or the stored one, did not verify (rule 11);
 * - `bundleMissing`: no bundle has arrived yet, so no license is known;
 * - `offlineTooLong`: no server contact for more than the maximum offline days (rule 7).
 */
export type LicenseRestriction =
  | "suspended"
  | "readOnly"
  | "clockBehind"
  | "clockWrong"
  | "bundleRefused"
  | "bundleMissing"
  | "offlineTooLong";

export interface DeviceLicense {
  /** The state held for the day with the license's dates; `null` without a verified license. */
  readonly standing: LicenseStanding | null;
  /** Why no document may be created now; `null` when documents may be. */
  readonly restriction: LicenseRestriction | null;
}

interface GuardRow {
  readonly highWaterMark: number;
  readonly serverTime: number | null;
  readonly localAtServerTime: number | null;
  readonly behindSince: number | null;
}

async function readGuard(executor: LocalExecutor): Promise<GuardRow | undefined> {
  return localOrm(executor).select().from(clockGuard).where(eq(clockGuard.id, 1)).get();
}

async function writeGuard(executor: LocalExecutor, row: GuardRow): Promise<void> {
  await localOrm(executor)
    .insert(clockGuard)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({ target: clockGuard.id, set: row });
}

/** What the clock guard says now. */
interface ClockReading {
  /**
   * The device's time: the last server time plus the local time elapsed since (on the mark), or
   * the mark itself before any server time.
   */
  readonly now: number;
  readonly behind: boolean;
  readonly wrong: boolean;
  readonly serverTime: number | null;
}

function readingOf(guard: GuardRow, mark: number, behind: boolean): ClockReading {
  const { serverTime, localAtServerTime } = guard;
  if (serverTime === null || localAtServerTime === null) {
    return { now: mark, behind, wrong: false, serverTime: null };
  }
  return {
    now: serverTime + Math.max(0, mark - localAtServerTime),
    behind,
    wrong: Math.abs(localAtServerTime - serverTime) > CLOCK_SKEW_LIMIT_MS,
    serverTime,
  };
}

/**
 * Observes the local clock (rule 8): a local time more than `CLOCK_TOLERANCE_MS` behind the mark
 * — the latest local time seen — marks the clock as moved back, which holds until the server is
 * reached; any other local time raises the mark.
 */
async function observeClock(tx: LocalExecutor, clock: Clock): Promise<ClockReading> {
  const now = clock.now().getTime();
  const guard = await readGuard(tx);
  if (guard === undefined) {
    const first = {
      highWaterMark: now,
      serverTime: null,
      localAtServerTime: null,
      behindSince: null,
    };
    await writeGuard(tx, first);
    return readingOf(first, now, false);
  }
  if (now < guard.highWaterMark - CLOCK_TOLERANCE_MS) {
    if (guard.behindSince === null) await writeGuard(tx, { ...guard, behindSince: now });
    return readingOf(guard, guard.highWaterMark, true);
  }
  if (now >= guard.highWaterMark + MARK_WRITE_STEP_MS) {
    await writeGuard(tx, { ...guard, highWaterMark: now });
  }
  return readingOf(guard, Math.max(guard.highWaterMark, now), guard.behindSince !== null);
}

/**
 * Takes a trusted server time (verified with the bundle key for this device): a server contact.
 * The device's time is the server's from now on, so the mark restarts from the local clock and a
 * clock moved back is forgiven — it gains nothing, since the license reads the server's time —
 * while its offset from the server is kept: more than `CLOCK_SKEW_LIMIT_MS` is `clockWrong`. A
 * server time not later than the last one taken (a replay) is ignored. The contact also lifts the
 * day's «offline too long» (rule 7: until it syncs).
 */
export async function recordServerTime(db: LocalDb, serverTime: Date, clock: Clock): Promise<void> {
  const server = serverTime.getTime();
  if (Number.isNaN(server)) throw new RangeError("the server time is not a valid date");
  await db.transaction(async (tx) => {
    const guard = await readGuard(tx);
    if (guard !== undefined && guard.serverTime !== null && server <= guard.serverTime) return;
    const now = clock.now().getTime();
    await writeGuard(tx, {
      highWaterMark: now,
      serverTime: server,
      localAtServerTime: now,
      behindSince: null,
    });
    await localOrm(tx).update(licenseDay).set({ offlineExceeded: false });
  });
}

/** The license in a loaded bundle: the valid one, or the previous one kept after a refusal. */
function bundleOf(loaded: LoadedBundle): VerifiedBundle | undefined {
  return loaded.state === "none" ? undefined : loaded.bundle;
}

function licenseOf(bundle: VerifiedBundle | undefined): VerifiedLicense | undefined {
  const part = bundle?.parts[LICENSE_BUNDLE_PART];
  return part === undefined ? undefined : (part as VerifiedLicense);
}

interface DayRow {
  readonly businessDate: string;
  readonly state: LicenseState;
  readonly licenseIssuedAt: string;
  readonly offlineExceeded: boolean;
  readonly evaluatedAt: number;
}

async function readDay(executor: LocalExecutor): Promise<DayRow | undefined> {
  const row = await localOrm(executor).select().from(licenseDay).where(eq(licenseDay.id, 1)).get();
  return row === undefined ? undefined : { ...row, state: row.state as LicenseState };
}

async function writeDay(executor: LocalExecutor, row: DayRow): Promise<void> {
  await localOrm(executor)
    .insert(licenseDay)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({ target: licenseDay.id, set: row });
}

/** The day's evaluation of `license` at the device's time (rules 3, 6, 7). */
function evaluate(license: VerifiedLicense, bundle: VerifiedBundle, reading: ClockReading): DayRow {
  const { claims } = license;
  // The bundle's own signed time is a server contact too: a device that upgraded before it
  // recorded one still counts its offline days from its bundle.
  const contact = Math.max(
    reading.serverTime ?? Number.NEGATIVE_INFINITY,
    Date.parse(bundle.issuedAt),
  );
  return {
    businessDate: businessDate(new Date(reading.now)),
    state: licenseState(claims, new Date(reading.now)),
    licenseIssuedAt: claims.issuedAt,
    offlineExceeded: reading.now - contact > claims.maxOfflineDays * MS_PER_DAY,
    evaluatedAt: reading.now,
  };
}

const rank = (state: LicenseState) => LICENSE_STATES.indexOf(state);

/**
 * A license issued after the one the day was evaluated with lifts at once what it improves
 * (rule 6: a renewal applies at once); what it makes worse waits for the next business day.
 */
function renewed(day: DayRow, next: DayRow): DayRow {
  return {
    ...day,
    state: rank(next.state) < rank(day.state) ? next.state : day.state,
    offlineExceeded: day.offlineExceeded && next.offlineExceeded,
    licenseIssuedAt: next.licenseIssuedAt,
  };
}

function restrictionOf(
  loaded: LoadedBundle,
  day: DayRow | undefined,
  reading: ClockReading,
): LicenseRestriction | null {
  if (day === undefined) return loaded.state === "refused" ? "bundleRefused" : "bundleMissing";
  if (day.state === "suspended") return "suspended";
  if (day.state === "readOnly") return "readOnly";
  if (reading.behind) return "clockBehind";
  if (reading.wrong) return "clockWrong";
  if (loaded.state === "refused") return "bundleRefused";
  if (day.offlineExceeded) return "offlineTooLong";
  return null;
}

async function resolve(
  db: LocalDb,
  loaded: LoadedBundle,
  clock: Clock,
  opening: boolean,
): Promise<DeviceLicense> {
  return db.transaction(async (tx) => {
    const reading = await observeClock(tx, clock);
    const bundle = bundleOf(loaded);
    const license = licenseOf(bundle);
    let day = await readDay(tx);
    if (license !== undefined && bundle !== undefined) {
      const current = evaluate(license, bundle, reading);
      // The first evaluation, or a sign-in on a later business day (rule 6). A session that
      // runs past midnight keeps its day's state.
      if (day === undefined || (opening && day.businessDate !== current.businessDate)) {
        day = current;
        await writeDay(tx, day);
      } else if (Date.parse(current.licenseIssuedAt) > Date.parse(day.licenseIssuedAt)) {
        day = renewed(day, current);
        await writeDay(tx, day);
      }
    }
    return {
      standing:
        license === undefined || day === undefined
          ? null
          : licenseStanding(license.claims, day.state),
      restriction: restrictionOf(loaded, license === undefined ? undefined : day, reading),
    };
  });
}

/**
 * At a sign-in or an unlock on this device (rule 6): evaluates the license's state and the
 * offline days when the business day changed since the last evaluation, then answers what
 * `deviceLicense` answers.
 */
export function openLicenseDay(
  db: LocalDb,
  loaded: LoadedBundle,
  clock: Clock,
): Promise<DeviceLicense> {
  return resolve(db, loaded, clock, true);
}

/**
 * The license as this device applies it now: the day's held state, a renewal applied at once,
 * the clock guard, and the bundle's own state. Only the first evaluation happens here; a new
 * business day waits for a sign-in (`openLicenseDay`). Before any document is created (ADR-0021).
 */
export function deviceLicense(
  db: LocalDb,
  loaded: LoadedBundle,
  clock: Clock,
): Promise<DeviceLicense> {
  return resolve(db, loaded, clock, false);
}
