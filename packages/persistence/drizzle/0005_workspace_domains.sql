CREATE TABLE "workspace_domains" (
	"host" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_domains_host_check" CHECK (host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'::text)
);
--> statement-breakpoint
ALTER TABLE "workspace_domains" ADD CONSTRAINT "workspace_domains_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_domains_workspace" ON "workspace_domains" USING btree ("workspace_id");