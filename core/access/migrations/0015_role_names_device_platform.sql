DROP INDEX "core_access"."roles_active_name_per_tenant";--> statement-breakpoint
-- Role names become unique among all of a tenant's roles, archived ones included, compared
-- trimmed, with collapsed spaces, and case-insensitive; devices record their platform
-- (`core-foundation` slice 20). Rows written before are brought in line first, across every
-- tenant, so row-level security is lifted for the owner running this migration and forced again
-- below. The spaces are those JavaScript's `\s` matches, as `recordNameSchema` collapses them.
-- Where two role names now collide, the owner role, then an active one, then the oldest keeps it
-- and each other gets the first free « (2)», « (3)»…. A device registered before told only its
-- type, which decided its platform in V1 (ADR-0019): the main POS is the Windows app, a
-- companion a browser.
ALTER TABLE "core_access"."roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "core_access"."roles"
  SET "name" = btrim(regexp_replace("name", '[\s   -     　﻿]+', ' ', 'g'))
  WHERE "name" <> btrim(regexp_replace("name", '[\s   -     　﻿]+', ' ', 'g'));--> statement-breakpoint
DO $$
DECLARE
  "row" record;
  "n" integer;
BEGIN
  FOR "row" IN
    SELECT "id", "tenant_id", "name" FROM (
      SELECT "id", "tenant_id", "name", row_number() OVER (
        PARTITION BY "tenant_id", lower("name")
        ORDER BY "is_owner" DESC, "archived_at" IS NOT NULL, "created_at", "id"
      ) AS "rank"
      FROM "core_access"."roles"
    ) AS "ranked"
    WHERE "rank" > 1
  LOOP
    "n" := 2;
    WHILE EXISTS (
      SELECT 1 FROM "core_access"."roles"
      WHERE "tenant_id" = "row"."tenant_id" AND lower("name") = lower("row"."name" || ' (' || "n" || ')')
    ) LOOP
      "n" := "n" + 1;
    END LOOP;
    UPDATE "core_access"."roles" SET "name" = "row"."name" || ' (' || "n" || ')'
      WHERE "id" = "row"."id";
  END LOOP;
END;
$$;--> statement-breakpoint
ALTER TABLE "core_access"."roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_per_tenant" ON "core_access"."roles" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "core_access"."devices" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "core_access"."devices"
  SET "platform" = CASE "type" WHEN 'mainPos' THEN 'windows' ELSE 'browser' END;--> statement-breakpoint
ALTER TABLE "core_access"."devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ALTER COLUMN "platform" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD CONSTRAINT "devices_platform" CHECK ("core_access"."devices"."platform" in ('windows', 'browser'));--> statement-breakpoint
-- An owner renames a device; its prefix never changes (rule 30, non-negotiable 8).
GRANT UPDATE ("name") ON "core_access"."devices" TO mustawfi_app;
