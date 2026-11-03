CREATE TABLE "share_code_failures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "share_code_failures_source" ON "share_code_failures" USING btree ("source_hash","created_at" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "request_shares" DROP COLUMN "code_hash";--> statement-breakpoint
ALTER TABLE "request_shares" DROP COLUMN "code_expires_at";--> statement-breakpoint
ALTER TABLE "request_shares" DROP COLUMN "code_attempts";