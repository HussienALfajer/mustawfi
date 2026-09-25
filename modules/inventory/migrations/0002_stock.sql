ALTER TABLE "inventory"."products" ADD CONSTRAINT "products_id_per_tenant" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "inventory"."stock_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"on_hand" numeric(20, 4) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stock_levels_product_per_tenant" UNIQUE("tenant_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(20, 4) NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "stock_movements_quantity_not_zero" CHECK ("inventory"."stock_movements"."quantity" <> 0),
	CONSTRAINT "stock_movements_source_type" CHECK ("inventory"."stock_movements"."source_type" ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$')
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_levels" ADD CONSTRAINT "stock_levels_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "inventory"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;
