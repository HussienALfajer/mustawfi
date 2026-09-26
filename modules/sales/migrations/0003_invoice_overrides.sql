-- The supervisor overrides a sale needed (core-foundation slice 16): an immutable snapshot of what
-- the device attached; earlier invoices needed none. Adding a column fires no row trigger, so the
-- invoices' immutability guards stay in place.
ALTER TABLE "sales"."invoices" ADD COLUMN "overrides" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."invoices" ADD CONSTRAINT "invoices_overrides_array" CHECK (jsonb_typeof("sales"."invoices"."overrides") = 'array');
