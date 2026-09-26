import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fc, test as property } from "@fast-check/vitest";
import type { LoadedBundle } from "@mustawfi/core-config/client";
import { manualClock } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  businessDate,
  type LicenseClaims,
  licenseState,
  type VerifiedLicense,
} from "../shared/index.ts";
import {
  CLOCK_SKEW_LIMIT_MS,
  CLOCK_TOLERANCE_MS,
  deviceLicense,
  openLicenseDay,
  recordServerTime,
  tenancyLocalMigrations,
} from "./device-license.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 10:00 in Damascus (UTC+3). */
const START = new Date("2026-09-26T07:00:00.000Z");

function claims(overrides: Partial<LicenseClaims> = {}): LicenseClaims {
  return {
    tenant: "0199a000-0000-7000-8000-000000000001",
    plan: "phonesPro",
    issuedAt: "2026-09-01T00:00:00.000Z",
    notBefore: "2026-09-01T00:00:00.000Z",
    expiresAt: "2027-09-01T00:00:00.000Z",
    graceDays: 7,
    readOnlyDays: 30,
    maxOfflineDays: 10,
    limits: { users: 6, departments: 4, mainPosDevices: 3, companionDevices: 2 },
    entitlements: [],
    ...overrides,
  };
}

/** A verified bundle carrying `license`, as `loadBundle` answers it. */
function valid(license: LicenseClaims, issuedAt = START): LoadedBundle {
  const verified: VerifiedLicense = { kid: "test", claims: license };
  return {
    state: "valid",
    bundle: {
      version: 1,
      issuedAt: issuedAt.toISOString(),
      licenseRef: "0199a000-0000-7000-8000-000000000002",
      parts: { license: verified },
    },
  };
}

let db: LocalDb;
const clock = manualClock(START);

beforeEach(async () => {
  clock.set(START);
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, tenancyLocalMigrations);
});

afterEach(async () => {
  await db.close();
});

describe("the day's license state on a device (rule 6)", () => {
  it("is evaluated at the day's first sign-in and held for the rest of the day", async () => {
    // Expires at 18:00 Damascus the same day, with no grace: read-only from then on.
    const license = valid(claims({ expiresAt: "2026-09-26T15:00:00.000Z", graceDays: 0 }));
    expect((await openLicenseDay(db, license, clock)).standing?.state).toBe("expiring");
    clock.advance(10 * HOUR); // 20:00, past the expiry
    expect(await deviceLicense(db, license, clock)).toMatchObject({
      standing: { state: "expiring" },
      restriction: null,
    });
    // Signing in again the same day changes nothing.
    expect((await openLicenseDay(db, license, clock)).restriction).toBeNull();
  });

  it("keeps the state past midnight until a sign-in on the next business day", async () => {
    const license = valid(claims({ expiresAt: "2026-09-26T15:00:00.000Z", graceDays: 0 }));
    await openLicenseDay(db, license, clock);
    clock.advance(16 * HOUR); // 02:00 the next day, the session still open
    expect((await deviceLicense(db, license, clock)).restriction).toBeNull();
    expect(await openLicenseDay(db, license, clock)).toMatchObject({
      standing: { state: "readOnly", expiresAt: "2026-09-26T15:00:00.000Z" },
      restriction: "readOnly",
    });
  });

  it("changes the day at midnight in Damascus, not in UTC", async () => {
    const license = valid(claims({ expiresAt: "2026-09-26T19:00:00.000Z", graceDays: 0 }));
    clock.set(new Date("2026-09-26T20:30:00.000Z")); // 23:30 in Damascus, already read-only
    await openLicenseDay(db, license, clock);
    clock.set(new Date("2026-09-26T21:30:00.000Z")); // 00:30 on the 27th in Damascus
    expect(businessDate(clock.now())).toBe("2026-09-27");
    expect((await openLicenseDay(db, license, clock)).restriction).toBe("readOnly");
  });

  it("lifts a restriction at once when a renewal arrives, and a worse license waits a day", async () => {
    const expired = claims({ expiresAt: "2026-09-01T00:00:00.000Z", graceDays: 0 });
    expect((await openLicenseDay(db, valid(expired), clock)).restriction).toBe("readOnly");
    const renewal = claims({ issuedAt: "2026-09-26T06:00:00.000Z" });
    expect(await deviceLicense(db, valid(renewal), clock)).toMatchObject({
      standing: { state: "active" },
      restriction: null,
    });
    // A later license that is worse (a shortened term) waits for the next business day.
    const shortened = claims({
      issuedAt: "2026-09-26T06:30:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
      graceDays: 0,
    });
    expect((await deviceLicense(db, valid(shortened), clock)).restriction).toBeNull();
    clock.advance(DAY);
    expect((await openLicenseDay(db, valid(shortened), clock)).restriction).toBe("readOnly");
  });

  it("holds suspended as its own restriction", async () => {
    const suspended = claims({
      expiresAt: "2026-08-01T00:00:00.000Z",
      graceDays: 0,
      readOnlyDays: 1,
    });
    expect((await openLicenseDay(db, valid(suspended), clock)).restriction).toBe("suspended");
  });

  it("is read-only without a bundle, or when the bundle was refused", async () => {
    expect(await openLicenseDay(db, { state: "none" }, clock)).toEqual({
      standing: null,
      restriction: "bundleMissing",
    });
    expect(
      await deviceLicense(
        db,
        { state: "refused", reason: "badSignature", bundle: undefined },
        clock,
      ),
    ).toEqual({ standing: null, restriction: "bundleRefused" });
    // A refusal that kept the previous bundle: its license still reads, but nothing is sold.
    const previous = valid(claims());
    if (previous.state !== "valid") throw new Error("unreachable");
    expect(
      await deviceLicense(
        db,
        { state: "refused", reason: "badHash", bundle: previous.bundle },
        clock,
      ),
    ).toMatchObject({ standing: { state: "active" }, restriction: "bundleRefused" });
  });

  property.prop([
    fc.array(fc.integer({ min: 0, max: 3 * HOUR }), { minLength: 1, maxLength: 12 }),
    fc.integer({ min: -30, max: 30 }),
  ])(
    "holds the state of the day's first sign-in whatever happens later that day",
    async (steps, expiryDays) => {
      const local = openNodeLocalDb(":memory:");
      try {
        await migrateLocalDb(local, tenancyLocalMigrations);
        // 00:05 in Damascus: the whole day lies ahead.
        const dayStart = new Date("2026-09-25T21:05:00.000Z");
        const at = manualClock(dayStart);
        const terms = claims({
          expiresAt: new Date(dayStart.getTime() + expiryDays * HOUR * 12).toISOString(),
          graceDays: 1,
          readOnlyDays: 1,
        });
        const license = valid(terms, dayStart);
        const first = await openLicenseDay(local, license, at);
        expect(first.standing?.state).toBe(licenseState(terms, dayStart));
        for (const step of steps) {
          at.advance(step);
          if (businessDate(at.now()) !== businessDate(dayStart)) break;
          const later = await openLicenseDay(local, license, at);
          expect(later.standing?.state).toBe(first.standing?.state);
        }
      } finally {
        await local.close();
      }
    },
  );
});

describe("the clock guard (rule 8)", () => {
  it("goes read-only at once when the clock moves back more than five minutes", async () => {
    const license = valid(claims());
    await openLicenseDay(db, license, clock);
    clock.advance(-CLOCK_TOLERANCE_MS + MINUTE); // four minutes back: tolerated
    expect((await deviceLicense(db, license, clock)).restriction).toBeNull();
    clock.set(new Date(START.getTime() - HOUR));
    expect((await deviceLicense(db, license, clock)).restriction).toBe("clockBehind");
    // Setting the clock right again is not enough: only the server lifts it.
    clock.set(START);
    expect((await deviceLicense(db, license, clock)).restriction).toBe("clockBehind");
    await recordServerTime(db, new Date(START.getTime() + MINUTE), clock);
    expect((await deviceLicense(db, license, clock)).restriction).toBeNull();
  });

  it("keeps the mark across a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mustawfi-clock-guard-"));
    const license = valid(claims());
    try {
      let file = openNodeLocalDb(join(dir, "local.db"));
      await migrateLocalDb(file, tenancyLocalMigrations);
      await openLicenseDay(file, license, clock);
      clock.advance(3 * HOUR);
      await deviceLicense(file, license, clock);
      await file.close();
      file = openNodeLocalDb(join(dir, "local.db"));
      clock.set(START); // three hours back, while the app was closed
      expect((await openLicenseDay(file, license, clock)).restriction).toBe("clockBehind");
      await file.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sells with a clock a few minutes off the server's, and not with one half an hour off", async () => {
    const license = valid(claims());
    await openLicenseDay(db, license, clock);
    // Eight minutes slow, as shop clocks drift: nothing to stop.
    await recordServerTime(db, new Date(START.getTime() + 8 * MINUTE), clock);
    expect((await deviceLicense(db, license, clock)).restriction).toBeNull();
    clock.advance(MINUTE);
    await recordServerTime(
      db,
      new Date(clock.now().getTime() + CLOCK_SKEW_LIMIT_MS + MINUTE),
      clock,
    );
    expect((await deviceLicense(db, license, clock)).restriction).toBe("clockWrong");
    // Once the clock is right at the next server time, the device sells again.
    clock.set(new Date(clock.now().getTime() + CLOCK_SKEW_LIMIT_MS + 2 * MINUTE));
    await recordServerTime(db, clock.now(), clock);
    expect((await deviceLicense(db, license, clock)).restriction).toBeNull();
  });

  it("reads the license by the server's time, not by a wrong local clock", async () => {
    // Expires in two hours by the server's clock; the device's clock is a day ahead.
    const license = valid(
      claims({ expiresAt: new Date(START.getTime() + 2 * HOUR).toISOString(), graceDays: 0 }),
    );
    clock.set(new Date(START.getTime() + DAY));
    await recordServerTime(db, START, clock);
    expect(await openLicenseDay(db, license, clock)).toMatchObject({
      standing: { state: "expiring" },
      restriction: "clockWrong",
    });
    // And the local time elapsed since counts: three hours later it is read-only.
    clock.advance(3 * HOUR);
    expect(await deviceLicense(db, license, clock)).toMatchObject({ restriction: "clockWrong" });
    clock.advance(DAY);
    expect((await openLicenseDay(db, license, clock)).standing?.state).toBe("readOnly");
  });

  it("stops a clock reset to 2009 by a dead battery, before and after the server is reached", async () => {
    const license = valid(claims());
    await recordServerTime(db, START, clock);
    await openLicenseDay(db, license, clock);
    clock.set(new Date("2009-01-01T00:00:00.000Z"));
    expect((await openLicenseDay(db, license, clock)).restriction).toBe("clockBehind");
    await recordServerTime(db, new Date(START.getTime() + MINUTE), clock);
    expect((await deviceLicense(db, license, clock)).restriction).toBe("clockWrong");
  });

  it("comes down to the server's time once a clock set too far ahead is corrected", async () => {
    const license = valid(claims());
    clock.set(new Date(START.getTime() + 2 * DAY)); // wrongly two days ahead
    await openLicenseDay(db, license, clock);
    clock.set(START); // corrected
    expect((await deviceLicense(db, license, clock)).restriction).toBe("clockBehind");
    await recordServerTime(db, START, clock);
    expect((await deviceLicense(db, license, clock)).restriction).toBeNull();
  });

  it("ignores a server time that is not later than the last one taken (a replay)", async () => {
    const license = valid(claims());
    await openLicenseDay(db, license, clock);
    await recordServerTime(db, START, clock);
    clock.set(new Date(START.getTime() - HOUR));
    expect((await deviceLicense(db, license, clock)).restriction).toBe("clockBehind");
    await recordServerTime(db, START, clock);
    await recordServerTime(db, new Date(START.getTime() - HOUR), clock);
    expect((await deviceLicense(db, license, clock)).restriction).toBe("clockBehind");
  });
});

describe("maximum offline days (rule 7)", () => {
  it("is read-only from the first sign-in past the limit until the device syncs", async () => {
    const license = valid(claims({ maxOfflineDays: 10 }));
    await recordServerTime(db, START, clock);
    await openLicenseDay(db, license, clock);
    clock.advance(10 * DAY - HOUR);
    expect((await openLicenseDay(db, license, clock)).restriction).toBeNull();
    clock.advance(2 * HOUR); // past ten days since the last contact, the same business day
    expect((await openLicenseDay(db, license, clock)).restriction).toBeNull();
    clock.advance(DAY);
    expect((await openLicenseDay(db, license, clock)).restriction).toBe("offlineTooLong");
    await recordServerTime(db, clock.now(), clock);
    expect((await deviceLicense(db, license, clock)).restriction).toBeNull();
  });

  it("counts against the mark, so moving the clock back does not buy days", async () => {
    const license = valid(claims({ maxOfflineDays: 10 }));
    await recordServerTime(db, START, clock);
    await openLicenseDay(db, license, clock);
    clock.advance(11 * DAY);
    expect((await openLicenseDay(db, license, clock)).restriction).toBe("offlineTooLong");
    clock.set(new Date(START.getTime() + DAY));
    expect((await openLicenseDay(db, license, clock)).restriction).not.toBeNull();
  });

  it("counts from the bundle's signed time when no server time was taken yet", async () => {
    const license = valid(claims({ maxOfflineDays: 10 }), START);
    clock.advance(12 * DAY);
    expect((await openLicenseDay(db, license, clock)).restriction).toBe("offlineTooLong");
  });
});
