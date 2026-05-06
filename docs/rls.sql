-- ══════════════════════════════════════════════════════════════════
-- Row-Level Security (RLS) for Marketing Digital AI
-- ══════════════════════════════════════════════════════════════════
--
-- Multi-tenant isolation at the database layer.
-- The app already filters by `account_id` in every query, but a
-- bug or a forgotten `where` would leak one tenant's data to another.
-- RLS makes that class of bug structurally impossible.
--
-- Strategy:
--   - Policies use a custom GUC `app.account_id` set at the start
--     of each request (see src/lib/db/prisma.ts — you must call
--     `SET LOCAL app.account_id = '<id>'` inside a transaction).
--   - The Prisma client running with the SERVICE_ROLE key still
--     bypasses RLS by default (postgres role `service_role` has
--     `BYPASSRLS`). That's what we want for backend workers that
--     need to process webhooks before a user session exists. Make
--     sure user-facing routes use the RLS-scoped connection.
--   - Admin super-users in the product layer run with a separate
--     connection string that targets a role WITHOUT BYPASSRLS so
--     RLS still applies (defense in depth).
--
-- Apply this file once in the Supabase SQL Editor.
-- Safe to re-run — all policies use `IF NOT EXISTS` / `CREATE OR REPLACE`.
-- ══════════════════════════════════════════════════════════════════

-- ── Helper: current account id from the connection-level GUC ──
CREATE OR REPLACE FUNCTION public.current_account_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.account_id', true), '')
$$ LANGUAGE SQL STABLE;

-- ══════════════════════════════════════════════════════════════════
-- accounts
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_isolation ON "accounts";
CREATE POLICY accounts_isolation ON "accounts"
  USING (id = public.current_account_id())
  WITH CHECK (id = public.current_account_id());

-- ══════════════════════════════════════════════════════════════════
-- account_members
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "account_members" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_members_isolation ON "account_members";
CREATE POLICY account_members_isolation ON "account_members"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

-- ══════════════════════════════════════════════════════════════════
-- leads
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_isolation ON "leads";
CREATE POLICY leads_isolation ON "leads"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

-- ══════════════════════════════════════════════════════════════════
-- conversations + messages
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_isolation ON "conversations";
CREATE POLICY conversations_isolation ON "conversations"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_isolation ON "messages";
CREATE POLICY messages_isolation ON "messages"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

-- ══════════════════════════════════════════════════════════════════
-- campaigns + ai_configs + knowledge_entries
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaigns_isolation ON "campaigns";
CREATE POLICY campaigns_isolation ON "campaigns"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

ALTER TABLE "ai_configs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_configs_isolation ON "ai_configs";
CREATE POLICY ai_configs_isolation ON "ai_configs"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

ALTER TABLE "knowledge_entries" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS knowledge_entries_isolation ON "knowledge_entries";
CREATE POLICY knowledge_entries_isolation ON "knowledge_entries"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

-- ══════════════════════════════════════════════════════════════════
-- channels + webhooks + event_logs
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channels_isolation ON "channels";
CREATE POLICY channels_isolation ON "channels"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhooks_isolation ON "webhooks";
CREATE POLICY webhooks_isolation ON "webhooks"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

ALTER TABLE "event_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_logs_isolation ON "event_logs";
CREATE POLICY event_logs_isolation ON "event_logs"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

-- ══════════════════════════════════════════════════════════════════
-- Integrations (Google / Meta)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "google_calendar_integrations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gcal_isolation ON "google_calendar_integrations";
CREATE POLICY gcal_isolation ON "google_calendar_integrations"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

ALTER TABLE "meta_integrations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_isolation ON "meta_integrations";
CREATE POLICY meta_isolation ON "meta_integrations"
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());

-- ══════════════════════════════════════════════════════════════════
-- Users table is intentionally NOT RLS-scoped by account — a user may
-- belong to multiple accounts (future), and the join lives in
-- account_members. Add a policy later if you introduce a per-user key.
-- ══════════════════════════════════════════════════════════════════
