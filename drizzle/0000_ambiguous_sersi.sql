-- Schema "standardization_app" provisioned externally; CREATE SCHEMA stripped.
CREATE TABLE IF NOT EXISTS "standardization_app"."email_verification_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."enumerators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"enumerator_id" integer NOT NULL,
	"display_name" text,
	"measures_muac" boolean DEFAULT true NOT NULL,
	"measures_weight" boolean DEFAULT true NOT NULL,
	"measures_height" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."group_completion_marks" (
	"group_id" uuid NOT NULL,
	"enumerator_id" integer NOT NULL,
	"marked_complete_by" uuid NOT NULL,
	"marked_complete_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_completion_marks_group_id_enumerator_id_pk" PRIMARY KEY("group_id","enumerator_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."odk_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"email" text NOT NULL,
	"encrypted_token" text,
	"token_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."password_reset_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."submission_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"submission_uuid" text NOT NULL,
	"field_name" text NOT NULL,
	"original_value" text,
	"new_value" text NOT NULL,
	"set_by_user_id" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."test_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"group_number" integer NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."test_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"odk_project_id" integer NOT NULL,
	"odk_form_id" text NOT NULL,
	"pull_from_date" date NOT NULL,
	"supervisor_enumerator_id" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standardization_app"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "standardization_app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."enumerators" ADD CONSTRAINT "enumerators_group_id_test_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "standardization_app"."test_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."group_completion_marks" ADD CONSTRAINT "group_completion_marks_group_id_test_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "standardization_app"."test_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."group_completion_marks" ADD CONSTRAINT "group_completion_marks_marked_complete_by_users_id_fk" FOREIGN KEY ("marked_complete_by") REFERENCES "standardization_app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."odk_credentials" ADD CONSTRAINT "odk_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "standardization_app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "standardization_app"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."submission_overrides" ADD CONSTRAINT "submission_overrides_instance_id_test_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "standardization_app"."test_instances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."submission_overrides" ADD CONSTRAINT "submission_overrides_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "standardization_app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."test_groups" ADD CONSTRAINT "test_groups_instance_id_test_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "standardization_app"."test_instances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standardization_app"."test_instances" ADD CONSTRAINT "test_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "standardization_app"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enumerators_group_enum_uniq" ON "standardization_app"."enumerators" USING btree ("group_id","enumerator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "overrides_instance_uuid_idx" ON "standardization_app"."submission_overrides" USING btree ("instance_id","submission_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "test_groups_instance_group_uniq" ON "standardization_app"."test_groups" USING btree ("instance_id","group_number");