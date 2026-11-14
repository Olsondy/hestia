CREATE TABLE "model_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure" text,
	"started_by" text NOT NULL,
	CONSTRAINT "model_checks_status_check" CHECK (status = ANY (ARRAY['running'::text, 'passed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"input_per_million" bigint NOT NULL,
	"output_per_million" bigint NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_prices_nonnegative" CHECK (input_per_million >= 0 AND output_per_million >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"base_url" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"key_tail" text NOT NULL,
	"compat" jsonb NOT NULL,
	"timeout_seconds" integer NOT NULL,
	"concurrency" integer NOT NULL,
	"ping" jsonb,
	"catalog" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_services_protocol_check" CHECK (protocol = ANY (ARRAY['chat'::text, 'responses'::text, 'anthropic'::text])),
	CONSTRAINT "model_services_limits_check" CHECK (timeout_seconds BETWEEN 5 AND 600 AND concurrency BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"max_output" integer NOT NULL,
	"params" jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_service_model_key" UNIQUE("service_id","model_id"),
	CONSTRAINT "models_state_check" CHECK (state = ANY (ARRAY['draft'::text, 'checking'::text, 'admitted'::text, 'failed'::text, 'stale'::text, 'disabled'::text]))
);
--> statement-breakpoint
ALTER TABLE "model_checks" ADD CONSTRAINT "model_checks_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_service_id_model_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."model_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_checks_model" ON "model_checks" USING btree ("model_id","started_at");--> statement-breakpoint
CREATE INDEX "model_prices_model" ON "model_prices" USING btree ("model_id","effective_at");