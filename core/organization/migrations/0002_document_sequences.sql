CREATE TABLE "core_organization"."document_sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"doc_code" text NOT NULL,
	"last_seq" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_sequences_per_device_code" UNIQUE("tenant_id","device_id","doc_code"),
	CONSTRAINT "document_sequences_doc_code" CHECK ("core_organization"."document_sequences"."doc_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "document_sequences_last_seq_positive" CHECK ("core_organization"."document_sequences"."last_seq" > 0)
);
