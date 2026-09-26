-- Device events (`core-foundation` rule 33): `created_at` stays the time of the event (the
-- device's clock for a device event), `recorded_at` is when the server received it, and `source`
-- says where it happened.
ALTER TABLE "core_audit"."entries" ADD COLUMN "recorded_at" timestamp with time zone;--> statement-breakpoint
-- Every entry before this migration was written by the server as it happened, so it was recorded
-- at `created_at`. The column is filled by rewriting the table (a type change with `USING`), not by
-- an UPDATE: a rewrite fires no row trigger and is not filtered by row-level security, so the
-- append-only trigger and the forced policy stay in place, and no recorded value changes.
ALTER TABLE "core_audit"."entries"
  ALTER COLUMN "recorded_at" SET DATA TYPE timestamp with time zone USING "created_at";--> statement-breakpoint
ALTER TABLE "core_audit"."entries" ALTER COLUMN "recorded_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "core_audit"."entries" ADD COLUMN "source" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "core_audit"."entries" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "core_audit"."entries" ADD CONSTRAINT "entries_source"
  CHECK ("source" IN ('server', 'device'));--> statement-breakpoint
-- A server event is recorded as it happens; a device event names its device.
ALTER TABLE "core_audit"."entries" ADD CONSTRAINT "entries_source_times"
  CHECK (("source" = 'server' AND "recorded_at" = "created_at")
    OR ("source" = 'device' AND "device_id" IS NOT NULL));
