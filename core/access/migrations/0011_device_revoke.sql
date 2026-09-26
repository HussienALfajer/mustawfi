ALTER TABLE "core_access"."devices" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD COLUMN "wiped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD CONSTRAINT "devices_revoke_complete" CHECK (("core_access"."devices"."revoked_at" is null) = ("core_access"."devices"."revoked_by" is null) and ("core_access"."devices"."revoked_at" is null) = ("core_access"."devices"."revoke_reason" is null));--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD CONSTRAINT "devices_wiped_after_revoke" CHECK ("core_access"."devices"."wiped_at" is null or "core_access"."devices"."revoked_at" is not null);