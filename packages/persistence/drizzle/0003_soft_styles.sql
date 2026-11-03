CREATE TABLE "workspace_soft_styles" (
	"workspace_id" uuid NOT NULL,
	"style_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_soft_styles_pkey" PRIMARY KEY("workspace_id","style_id","version"),
	CONSTRAINT "workspace_soft_styles_status_check" CHECK (status = ANY (ARRAY['active'::text, 'retired'::text]))
);
--> statement-breakpoint
ALTER TABLE "workspace_soft_styles" ADD CONSTRAINT "workspace_soft_styles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;