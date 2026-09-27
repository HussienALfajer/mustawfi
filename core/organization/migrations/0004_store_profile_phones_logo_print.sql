ALTER TABLE "core_organization"."store_profiles" ADD COLUMN "unreadable_phones" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "core_organization"."store_profiles" ADD COLUMN "logo_print" text DEFAULT 'threshold' NOT NULL;--> statement-breakpoint
-- Phones are stored in E.164 from `core-foundation` slice 21. Numbers written before, as people
-- typed them (digits, `+`, spaces, dashes), are brought to that shape across every tenant, so
-- row-level security is lifted for the owner running this migration and forced again below:
-- `+…` keeps its digits, `00…` becomes `+…`, and a national number is read as Syrian (`0944…`
-- and `944…` become `+963944…`). Nothing typed is lost: text that still has no plausible E.164
-- shape (7 to 15 digits after the code's first) — two numbers in one field, a stray fragment —
-- moves, as typed, to `unreadable_phones`. The store profile screen shows those, and numbers
-- with the shape that are no real number, flagged on their fields; the owner's next save
-- replaces them, audited with before and after.
ALTER TABLE "core_organization"."store_profiles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
WITH "typed" AS (
  SELECT "profile"."id", "phone"."text", "phone"."position", CASE
      WHEN "phone"."text" ~ '^\s*[+]' THEN '+' || "only"."digits"
      WHEN "only"."digits" ~ '^00' THEN '+' || substr("only"."digits", 3)
      WHEN "only"."digits" ~ '^0' THEN '+963' || substr("only"."digits", 2)
      ELSE '+963' || "only"."digits"
    END AS "e164"
  FROM "core_organization"."store_profiles" AS "profile",
    unnest("profile"."phones") WITH ORDINALITY AS "phone" ("text", "position"),
    LATERAL (SELECT regexp_replace("phone"."text", '[^0-9]', '', 'g') AS "digits") AS "only"
),
"sorted" AS (
  SELECT "id",
    coalesce(array_agg("e164" ORDER BY "position")
      FILTER (WHERE "e164" ~ '^[+][1-9][0-9]{6,14}$'), '{}') AS "phones",
    coalesce(array_agg("text" ORDER BY "position")
      FILTER (WHERE "e164" !~ '^[+][1-9][0-9]{6,14}$'), '{}') AS "unreadable"
  FROM "typed"
  GROUP BY "id"
)
UPDATE "core_organization"."store_profiles" AS "profile"
  SET "phones" = "sorted"."phones", "unreadable_phones" = "sorted"."unreadable"
  FROM "sorted"
  WHERE "profile"."id" = "sorted"."id";--> statement-breakpoint
ALTER TABLE "core_organization"."store_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core_organization"."store_profiles" ADD CONSTRAINT "store_profiles_phones_e164" CHECK (array_to_string("core_organization"."store_profiles"."phones", ',') ~ '^([+][1-9][0-9]{1,14}(,[+][1-9][0-9]{1,14})*)?$');--> statement-breakpoint
ALTER TABLE "core_organization"."store_profiles" ADD CONSTRAINT "store_profiles_unreadable_phones" CHECK (cardinality("core_organization"."store_profiles"."phones") + cardinality("core_organization"."store_profiles"."unreadable_phones") <= 3);--> statement-breakpoint
ALTER TABLE "core_organization"."store_profiles" ADD CONSTRAINT "store_profiles_logo_print" CHECK ("core_organization"."store_profiles"."logo_print" in ('threshold', 'dither'));
