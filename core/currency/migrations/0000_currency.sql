CREATE SCHEMA "core_currency";
--> statement-breakpoint
CREATE TABLE "core_currency"."currency_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"change_currency" text NOT NULL,
	"rate_change_threshold_percent" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "currency_settings_one_per_tenant" UNIQUE("tenant_id"),
	CONSTRAINT "currency_settings_threshold" CHECK ("core_currency"."currency_settings"."rate_change_threshold_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "core_currency"."exchange_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"unit_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"device_id" uuid,
	"op_id" uuid,
	CONSTRAINT "exchange_rates_quote_direction" CHECK (("core_currency"."exchange_rates"."unit_currency", "core_currency"."exchange_rates"."quote_currency") in (('USD', 'SYP'), ('TRY', 'SYP'), ('USD', 'TRY'))),
	CONSTRAINT "exchange_rates_rate_fits_devices" CHECK ("core_currency"."exchange_rates"."rate" > 0 and "core_currency"."exchange_rates"."rate" < 1000000000000),
	CONSTRAINT "exchange_rates_device_op" CHECK (("core_currency"."exchange_rates"."device_id" is null) = ("core_currency"."exchange_rates"."op_id" is null))
);
--> statement-breakpoint
CREATE TABLE "core_currency"."tenant_currencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean NOT NULL,
	"cash_rounding_step" numeric(20, 4) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "tenant_currencies_code_per_tenant" UNIQUE("tenant_id","code"),
	CONSTRAINT "tenant_currencies_code" CHECK ("core_currency"."tenant_currencies"."code" in ('SYP', 'USD', 'TRY')),
	CONSTRAINT "tenant_currencies_cash_rounding_step" CHECK ("core_currency"."tenant_currencies"."cash_rounding_step" > 0 and "core_currency"."tenant_currencies"."cash_rounding_step" <= 1000
        and "core_currency"."tenant_currencies"."cash_rounding_step" = round("core_currency"."tenant_currencies"."cash_rounding_step", 2))
);
--> statement-breakpoint
ALTER TABLE "core_currency"."currency_settings" ADD CONSTRAINT "currency_settings_change_currency_fk" FOREIGN KEY ("tenant_id","change_currency") REFERENCES "core_currency"."tenant_currencies"("tenant_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_currency"."exchange_rates" ADD CONSTRAINT "exchange_rates_unit_currency_fk" FOREIGN KEY ("tenant_id","unit_currency") REFERENCES "core_currency"."tenant_currencies"("tenant_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_currency"."exchange_rates" ADD CONSTRAINT "exchange_rates_quote_currency_fk" FOREIGN KEY ("tenant_id","quote_currency") REFERENCES "core_currency"."tenant_currencies"("tenant_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_rates_current" ON "core_currency"."exchange_rates" USING btree ("tenant_id","unit_currency","quote_currency","effective_at","id");