CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE TABLE "inventory"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"barcode" text,
	"price" numeric(20, 6) NOT NULL,
	"price_currency" text NOT NULL,
	CONSTRAINT "products_barcode_per_tenant" UNIQUE("tenant_id","barcode"),
	CONSTRAINT "products_price_not_negative" CHECK ("inventory"."products"."price" >= 0),
	CONSTRAINT "products_price_currency" CHECK ("inventory"."products"."price_currency" ~ '^[A-Z]{3}$')
);
