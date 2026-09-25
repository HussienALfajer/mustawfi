CREATE SCHEMA "core_organization";
--> statement-breakpoint
CREATE TABLE "core_organization"."store_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phones" text[] NOT NULL,
	"tax_number" text,
	"commercial_register" text,
	"logo" "bytea",
	"logo_type" text,
	"logo_sha256" text,
	"logo_size" integer,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "store_profiles_one_per_tenant" UNIQUE("tenant_id"),
	CONSTRAINT "store_profiles_phones" CHECK (cardinality("core_organization"."store_profiles"."phones") <= 3),
	CONSTRAINT "store_profiles_logo" CHECK (("core_organization"."store_profiles"."logo" is null and "core_organization"."store_profiles"."logo_type" is null and "core_organization"."store_profiles"."logo_sha256" is null and "core_organization"."store_profiles"."logo_size" is null)
        or ("core_organization"."store_profiles"."logo_type" in ('image/png', 'image/jpeg') and "core_organization"."store_profiles"."logo_sha256" ~ '^[0-9a-f]{64}$'
          and "core_organization"."store_profiles"."logo_size" = octet_length("core_organization"."store_profiles"."logo") and "core_organization"."store_profiles"."logo_size" between 1 and 262144))
);
