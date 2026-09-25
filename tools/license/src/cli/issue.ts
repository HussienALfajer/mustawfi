import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { type LicenseLimits, licenseLimitsSchema } from "@mustawfi/core-tenancy/shared";
import { type Clock, cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { z } from "zod";
import { issueLicense, licenseClaimsFor, licensePrivateKeySchema } from "../license.ts";
import { isPlanCode, PLANS } from "../plans.ts";
import { type CommandIo, processIo } from "./io.ts";

const USAGE = `usage: pnpm --filter @mustawfi/tools-license license:issue --key <private key file> \
  --tenant <new | tenant id> --plan <${Object.keys(PLANS).join(" | ")}> \
  [--not-before <instant>] [--expires <instant>] [--limit <name>=<count> …] \
  [--grace-days <n>] [--read-only-days <n>] [--max-offline-days <n>]
An instant carries its offset: 2027-09-25T00:00:00+03:00.`;

/** An instant with an explicit offset, so the staff member's time zone never changes it. */
const instantSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const daysSchema = z
  .string()
  .regex(/^[0-9]+$/, "a number of days")
  .transform((value) => Number(value));
const limitSchema = z
  .string()
  .regex(/^[a-zA-Z]+=\d+$/, "a limit is <name>=<count>")
  .transform((value) => {
    const [name = "", count = ""] = value.split("=");
    return [name, Number(count)] as const;
  })
  .refine(([name]) => Object.hasOwn(licenseLimitsSchema.shape, name), "unknown limit");

class UsageError extends Error {}

function parse<T>(schema: z.ZodType<T>, value: unknown, flag: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new UsageError(`--${flag}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/**
 * `license:issue`: prints a license JWS signed with the given private key (ADR-0030). With
 * `--tenant new` the license names a new tenant id, which `tenant:create` then takes. A summary
 * goes to standard error. Returns the exit code: 0 done, 1 refused, 2 bad usage.
 */
export async function issueCommand(io: CommandIo, clock: Clock = systemClock): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...io.argv],
      options: {
        key: { type: "string" },
        tenant: { type: "string" },
        plan: { type: "string" },
        "not-before": { type: "string" },
        expires: { type: "string" },
        limit: { type: "string", multiple: true },
        "grace-days": { type: "string" },
        "read-only-days": { type: "string" },
        "max-offline-days": { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }

  let input;
  try {
    if (values.key === undefined) throw new UsageError("--key is required");
    if (values.plan === undefined || !isPlanCode(values.plan)) {
      throw new UsageError(`--plan must be one of ${Object.keys(PLANS).join(", ")}`);
    }
    const tenant =
      values.tenant === "new"
        ? uuidV7Generator({ clock, random: cryptoRandom })()
        : parse(z.uuid(), values.tenant, "tenant");
    const limits: Partial<Record<keyof LicenseLimits, number>> = {};
    for (const text of values.limit ?? []) {
      const [name, count] = parse(limitSchema, text, "limit");
      limits[name as keyof LicenseLimits] = count;
    }
    const optional = <T>(schema: z.ZodType<T>, flag: keyof typeof values) =>
      values[flag] === undefined ? undefined : parse(schema, values[flag], flag);
    input = {
      keyFile: values.key,
      terms: {
        tenant,
        plan: values.plan,
        issuedAt: clock.now(),
        notBefore: optional(instantSchema, "not-before"),
        expiresAt: optional(instantSchema, "expires"),
        graceDays: optional(daysSchema, "grace-days"),
        readOnlyDays: optional(daysSchema, "read-only-days"),
        maxOfflineDays: optional(daysSchema, "max-offline-days"),
        limits,
      },
    };
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }

  let privateKey;
  try {
    privateKey = licensePrivateKeySchema.parse(JSON.parse(await readFile(input.keyFile, "utf8")));
  } catch (error) {
    io.stderr.write(`${input.keyFile} is not a license private key: ${(error as Error).message}\n`);
    return 1;
  }
  const { terms } = input;
  let claims;
  try {
    claims = licenseClaimsFor({
      tenant: terms.tenant,
      plan: terms.plan,
      issuedAt: terms.issuedAt,
      limits: terms.limits,
      ...(terms.notBefore === undefined ? {} : { notBefore: terms.notBefore }),
      ...(terms.expiresAt === undefined ? {} : { expiresAt: terms.expiresAt }),
      ...(terms.graceDays === undefined ? {} : { graceDays: terms.graceDays }),
      ...(terms.readOnlyDays === undefined ? {} : { readOnlyDays: terms.readOnlyDays }),
      ...(terms.maxOfflineDays === undefined ? {} : { maxOfflineDays: terms.maxOfflineDays }),
    });
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    io.stderr.write(`the license would be invalid:
${z.prettifyError(error)}
`);
    return 1;
  }
  const jws = await issueLicense(claims, privateKey);
  io.stderr.write(
    `license for tenant ${claims.tenant}: ${claims.plan}, valid ${claims.notBefore} to ${claims.expiresAt}, ` +
      `limits ${JSON.stringify(claims.limits)}, key ${privateKey.kid}\n`,
  );
  io.stdout.write(`${jws}\n`);
  return 0;
}

if (import.meta.main) process.exitCode = await issueCommand(processIo());
