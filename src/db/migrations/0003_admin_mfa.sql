CREATE TABLE IF NOT EXISTS "admin_mfa_settings" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "encrypted_totp_secret" text,
  "pending_encrypted_secret" text,
  "recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "admin_mfa_settings" ("id", "enabled", "recovery_code_hashes")
VALUES ('default', false, '[]'::jsonb)
ON CONFLICT ("id") DO NOTHING;
