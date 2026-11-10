DROP INDEX "hestia_auth_user_phone_number";--> statement-breakpoint
ALTER TABLE "hestia_auth_user" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "phone_otp_challenges" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "hestia_auth_user" ADD CONSTRAINT "hestia_auth_user_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_otp_challenges" ADD CONSTRAINT "phone_otp_challenges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hestia_auth_user_phone_scope" ON "hestia_auth_user" USING btree (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),"phone_number") WHERE (phone_number IS NOT NULL);--> statement-breakpoint
CREATE INDEX "hestia_auth_user_workspace" ON "hestia_auth_user" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "phone_otp_challenges_workspace_phone" ON "phone_otp_challenges" USING btree ("workspace_id","phone_number","created_at" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "hestia_auth_user" ADD CONSTRAINT "hestia_auth_user_customer_scope" CHECK ((workspace_id IS NULL) OR ((phone_number IS NOT NULL) AND (email IS NULL)));