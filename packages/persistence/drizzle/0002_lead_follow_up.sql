CREATE TABLE "lead_follow_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_follow_events_kind_check" CHECK ((kind = 'status' AND status IS NOT NULL AND note IS NULL) OR (kind = 'note' AND status IS NULL AND note IS NOT NULL AND length(note) BETWEEN 1 AND 500)),
	CONSTRAINT "lead_follow_events_status_check" CHECK (status IS NULL OR status = ANY (ARRAY['new'::text, 'contacted'::text, 'active'::text, 'won'::text, 'parked'::text]))
);
--> statement-breakpoint
ALTER TABLE "finish_requests" ADD COLUMN "follow_status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_follow_events" ADD CONSTRAINT "lead_follow_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."finish_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_follow_events_request" ON "lead_follow_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "finish_requests_workspace_follow" ON "finish_requests" USING btree ("workspace_id","follow_status");--> statement-breakpoint
ALTER TABLE "finish_requests" ADD CONSTRAINT "finish_requests_follow_status_check" CHECK (follow_status = ANY (ARRAY['new'::text, 'contacted'::text, 'active'::text, 'won'::text, 'parked'::text]));