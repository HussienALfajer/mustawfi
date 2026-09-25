CREATE SCHEMA "core_ledger";
--> statement-breakpoint
CREATE TABLE "core_ledger"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"system_key" text,
	CONSTRAINT "accounts_code_per_tenant" UNIQUE("tenant_id","code"),
	CONSTRAINT "accounts_system_key_per_tenant" UNIQUE("tenant_id","system_key"),
	CONSTRAINT "accounts_id_per_tenant" UNIQUE("tenant_id","id"),
	CONSTRAINT "accounts_kind" CHECK ("core_ledger"."accounts"."kind" in ('asset', 'liability', 'equity', 'revenue', 'expense')),
	CONSTRAINT "accounts_system_key" CHECK ("core_ledger"."accounts"."system_key" in ('cash', 'salesRevenue', 'roundingDifferences'))
);
--> statement-breakpoint
CREATE TABLE "core_ledger"."journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"accounting_date" date NOT NULL,
	"currency" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"memo" text,
	CONSTRAINT "journal_entries_id_per_tenant" UNIQUE("tenant_id","id"),
	CONSTRAINT "journal_entries_currency" CHECK ("core_ledger"."journal_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "journal_entries_source_type" CHECK ("core_ledger"."journal_entries"."source_type" ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$')
);
--> statement-breakpoint
CREATE TABLE "core_ledger"."journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"debit" numeric(20, 4) NOT NULL,
	"credit" numeric(20, 4) NOT NULL,
	CONSTRAINT "journal_lines_line_no" UNIQUE("journal_entry_id","line_no"),
	CONSTRAINT "journal_lines_line_no_positive" CHECK ("core_ledger"."journal_lines"."line_no" > 0),
	CONSTRAINT "journal_lines_currency" CHECK ("core_ledger"."journal_lines"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "journal_lines_one_side" CHECK (("core_ledger"."journal_lines"."debit" > 0 and "core_ledger"."journal_lines"."credit" = 0) or ("core_ledger"."journal_lines"."credit" > 0 and "core_ledger"."journal_lines"."debit" = 0))
);
--> statement-breakpoint
ALTER TABLE "core_ledger"."journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("tenant_id","journal_entry_id") REFERENCES "core_ledger"."journal_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_ledger"."journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "core_ledger"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;