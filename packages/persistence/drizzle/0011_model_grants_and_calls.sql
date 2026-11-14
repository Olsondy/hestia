CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text,
	"task_id" uuid,
	"model_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reserved_fen" bigint NOT NULL,
	"cost_fen" bigint,
	"input_tokens" integer,
	"output_tokens" integer,
	"unverified" boolean DEFAULT false NOT NULL,
	"outcome" text,
	"elapsed_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "model_calls_month_format" CHECK (month ~ '^\d{4}-\d{2}$'),
	CONSTRAINT "model_calls_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'settled'::text])),
	CONSTRAINT "model_calls_settled" CHECK (status = 'reserved' OR cost_fen IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "workspace_model_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"monthly_quota" bigint,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_model_settings_limits" CHECK ((monthly_quota IS NULL OR monthly_quota >= 0) AND concurrency BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "workspace_models" (
	"workspace_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_models_workspace_id_model_id_pk" PRIMARY KEY("workspace_id","model_id"),
	CONSTRAINT "workspace_models_default_enabled" CHECK (NOT is_default OR enabled)
);
--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_user_id_hestia_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."hestia_auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_price_id_model_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."model_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_model_settings" ADD CONSTRAINT "workspace_model_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_models" ADD CONSTRAINT "workspace_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_models" ADD CONSTRAINT "workspace_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_calls_workspace_month" ON "model_calls" USING btree ("workspace_id","month");--> statement-breakpoint
CREATE INDEX "model_calls_in_flight" ON "model_calls" USING btree ("model_id") WHERE status = 'reserved';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_models_one_default" ON "workspace_models" USING btree ("workspace_id") WHERE is_default;