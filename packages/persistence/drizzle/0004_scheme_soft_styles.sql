ALTER TABLE "finish_scheme_revisions" ADD COLUMN "soft_style" jsonb;--> statement-breakpoint
ALTER TABLE "finish_schemes" ADD COLUMN "soft_style" jsonb;--> statement-breakpoint
ALTER TABLE "finish_schemes" ADD COLUMN "soft_choices" jsonb DEFAULT '[]'::jsonb NOT NULL;