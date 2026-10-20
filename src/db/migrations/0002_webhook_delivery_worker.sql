ALTER TABLE "webhook_deliveries" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
UPDATE "webhook_deliveries" SET "event_id" = "id"::text WHERE "event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_sub_event_uidx" ON "webhook_deliveries" USING btree ("subscription_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");
