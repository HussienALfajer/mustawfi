DROP INDEX "core_tenancy"."departments_active_name_per_tenant";--> statement-breakpoint
-- Names become unique among all of a tenant's departments, archived ones included, compared
-- trimmed, with collapsed spaces, and case-insensitive (`core-foundation` slice 20). Rows written
-- before are brought to that spelling first, across every tenant, so row-level security is lifted
-- for the owner running this migration and forced again below. The spaces are those JavaScript's
-- `\s` matches, as `recordNameSchema` collapses them. Where two names now collide, the active one
-- (else the oldest) keeps it and each other gets the first free « (2)», « (3)»….
ALTER TABLE "core_tenancy"."departments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "core_tenancy"."departments"
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
        ORDER BY "archived_at" IS NOT NULL, "created_at", "id"
      ) AS "rank"
      FROM "core_tenancy"."departments"
    ) AS "ranked"
    WHERE "rank" > 1
  LOOP
    "n" := 2;
    WHILE EXISTS (
      SELECT 1 FROM "core_tenancy"."departments"
      WHERE "tenant_id" = "row"."tenant_id" AND lower("name") = lower("row"."name" || ' (' || "n" || ')')
    ) LOOP
      "n" := "n" + 1;
    END LOOP;
    UPDATE "core_tenancy"."departments" SET "name" = "row"."name" || ' (' || "n" || ')'
      WHERE "id" = "row"."id";
  END LOOP;
END;
$$;--> statement-breakpoint
ALTER TABLE "core_tenancy"."departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_per_tenant" ON "core_tenancy"."departments" USING btree ("tenant_id",lower("name"));
