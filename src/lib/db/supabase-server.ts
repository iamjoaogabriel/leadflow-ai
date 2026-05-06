// src/lib/db/supabase-server.ts
//
// Server-side Supabase clients. Two flavors:
//
//   - createSupabaseAdmin(): service-role key, bypasses RLS, used by
//     workers / cron / webhooks where there's no logged-in user.
//
//   - getSupabaseAdmin(): cached singleton of the above so we don't
//     spin up a new HTTP-based client per request.
//
// All access goes through the Supabase REST + Realtime APIs over HTTPS.
// No Postgres connection pool is involved — so "Tenant or user not found",
// "EMAXCONNSESSION" and other pgBouncer issues simply cannot happen here.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "public" },
  });
  return _admin;
}

/** Backward-compat alias. */
export function createSupabaseAdmin(): SupabaseClient {
  return getSupabaseAdmin();
}
