CREATE TABLE "core_access"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"prefix" text NOT NULL,
	"credential_hash" text NOT NULL,
	"registration_code_id" uuid NOT NULL,
	CONSTRAINT "devices_credentialHash_unique" UNIQUE("credential_hash"),
	CONSTRAINT "devices_registrationCodeId_unique" UNIQUE("registration_code_id"),
	CONSTRAINT "devices_prefix_per_tenant" UNIQUE("tenant_id","prefix"),
	CONSTRAINT "devices_type" CHECK ("core_access"."devices"."type" in ('mainPos', 'companion')),
	CONSTRAINT "devices_prefix_format" CHECK ("core_access"."devices"."prefix" ~ '^[A-HJ-NP-Z2-9]{2}$'),
	CONSTRAINT "devices_credential_hash_format" CHECK ("core_access"."devices"."credential_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "core_access"."registration_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "registration_codes_hash_per_tenant" UNIQUE("tenant_id","code_hash"),
	CONSTRAINT "registration_codes_hash_format" CHECK ("core_access"."registration_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "core_access"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_token_hash_format" CHECK ("core_access"."sessions"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD CONSTRAINT "devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core_access"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD CONSTRAINT "devices_registration_code_id_registration_codes_id_fk" FOREIGN KEY ("registration_code_id") REFERENCES "core_access"."registration_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_access"."registration_codes" ADD CONSTRAINT "registration_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core_access"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_access"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core_access"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_access"."sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "core_access"."devices"("id") ON DELETE no action ON UPDATE no action;