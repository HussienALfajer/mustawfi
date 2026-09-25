CREATE SCHEMA "sales";
--> statement-breakpoint
CREATE TABLE "sales"."invoice_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"code" text NOT NULL,
	"detail" jsonb NOT NULL,
	CONSTRAINT "invoice_flags_code" CHECK ("sales"."invoice_flags"."code" in ('negativeStock', 'arithmeticMismatch'))
);
--> statement-breakpoint
CREATE TABLE "sales"."invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(20, 4) NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	CONSTRAINT "invoice_lines_line_no" UNIQUE("invoice_id","line_no"),
	CONSTRAINT "invoice_lines_line_no_positive" CHECK ("sales"."invoice_lines"."line_no" > 0),
	CONSTRAINT "invoice_lines_quantity_positive" CHECK ("sales"."invoice_lines"."quantity" > 0),
	CONSTRAINT "invoice_lines_unit_price_not_negative" CHECK ("sales"."invoice_lines"."unit_price" >= 0),
	CONSTRAINT "invoice_lines_amount_not_negative" CHECK ("sales"."invoice_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"number" text NOT NULL,
	"device_id" uuid NOT NULL,
	"doc_seq" bigint NOT NULL,
	"op_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(20, 6) NOT NULL,
	"department_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"template_version" text NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	CONSTRAINT "invoices_opId_unique" UNIQUE("op_id"),
	CONSTRAINT "invoices_number_per_tenant" UNIQUE("tenant_id","number"),
	CONSTRAINT "invoices_doc_seq_per_device" UNIQUE("tenant_id","device_id","doc_seq"),
	CONSTRAINT "invoices_id_per_tenant" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_doc_seq_positive" CHECK ("sales"."invoices"."doc_seq" > 0),
	CONSTRAINT "invoices_currency" CHECK ("sales"."invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoices_exchange_rate_positive" CHECK ("sales"."invoices"."exchange_rate" > 0),
	CONSTRAINT "invoices_total_not_negative" CHECK ("sales"."invoices"."total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales"."invoice_flags" ADD CONSTRAINT "invoice_flags_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "sales"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "sales"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;