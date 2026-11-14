CREATE TABLE "platform_admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_via" text NOT NULL,
	CONSTRAINT "platform_admins_level_check" CHECK (level = ANY (ARRAY['platform'::text, 'super'::text]))
);
--> statement-breakpoint
CREATE TABLE "platform_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_hestia_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."hestia_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_actor_user_id_hestia_auth_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."hestia_auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_at" ON "platform_audit" USING btree ("at" DESC NULLS LAST);