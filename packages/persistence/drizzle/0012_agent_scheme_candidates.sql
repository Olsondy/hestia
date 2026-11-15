CREATE TABLE "scheme_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"base_revision" integer NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"surface_design" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"soft_style" jsonb,
	"soft_choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"render_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"adopted_scheme_id" uuid,
	"adopted_by" text,
	"adopted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheme_candidates_task_operation_key" UNIQUE("task_id","operation_id"),
	CONSTRAINT "scheme_candidates_status_check" CHECK (status IN ('draft', 'adopted'))
);
--> statement-breakpoint
ALTER TABLE "finish_schemes" DROP CONSTRAINT "finish_schemes_ordinal_check";--> statement-breakpoint
ALTER TABLE "finish_schemes" ADD COLUMN "pending_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheme_candidates" ADD CONSTRAINT "scheme_candidates_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."finish_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_candidates" ADD CONSTRAINT "scheme_candidates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_candidates" ADD CONSTRAINT "scheme_candidates_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."design_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_candidates" ADD CONSTRAINT "scheme_candidates_render_id_fkey" FOREIGN KEY ("render_id") REFERENCES "public"."project_renders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_candidates" ADD CONSTRAINT "scheme_candidates_adopted_scheme_id_fkey" FOREIGN KEY ("adopted_scheme_id") REFERENCES "public"."finish_schemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheme_candidates_request_idx" ON "scheme_candidates" USING btree ("request_id","created_at");--> statement-breakpoint
ALTER TABLE "finish_schemes" ADD CONSTRAINT "finish_schemes_ordinal_check" CHECK ((ordinal >= 1) AND (ordinal <= 6));