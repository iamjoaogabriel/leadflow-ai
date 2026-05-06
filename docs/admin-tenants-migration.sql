-- ══════════════════════════════════════════════════════════════════
-- Admin Tenants Migration
-- ══════════════════════════════════════════════════════════════════
--
-- Adds the platform-level role system + tenant attribution + per-tenant
-- user cap.
--
-- Run ONCE in the Supabase SQL Editor. Idempotent (uses IF NOT EXISTS).
-- After running, set yourself as HIPER_ADMIN with the UPDATE at the end.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. PlatformRole enum ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlatformRole') THEN
    CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN', 'HIPER_ADMIN');
  END IF;
END $$;

-- ── 2. users.platform_role ──
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER';

-- ── 3. accounts.max_users + accounts.created_by_id ──
ALTER TABLE "accounts"
ADD COLUMN IF NOT EXISTS "max_users" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "accounts"
ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "accounts_created_by_id_idx" ON "accounts"("created_by_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_created_by_id_fkey'
  ) THEN
    ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════
-- BOOTSTRAP YOUR HIPER ADMIN
-- ══════════════════════════════════════════════════════════════════
-- Replace the email with your own and run it ONCE. This is the only
-- way to create the first HIPER_ADMIN — afterwards the UI takes over.
-- ══════════════════════════════════════════════════════════════════

UPDATE "users"
SET "platform_role" = 'HIPER_ADMIN'
WHERE email = 'imjoaogabriel@outlook.com';
