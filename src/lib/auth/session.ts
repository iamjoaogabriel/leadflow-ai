// src/lib/auth/session.ts
//
// Authenticated session resolver — Supabase-only, NO Prisma.
//
// Why: Prisma + Supabase pgBouncer (Supavisor) has been a recurring source
// of incidents in production (`Tenant or user not found`, `EMAXCONNSESSION`,
// region mismatches in the connection string, etc). The Supabase REST API
// has none of that — it goes over HTTPS and never opens a Postgres connection
// directly.
//
// The function returns enough info to gate the dashboard:
//   { userId, accountId, email, role, onboardingCompletedAt? }
//
// On the very first sign-in, it auto-provisions the User + Account +
// AccountMember + AIConfig rows so the dashboard always finds a tenant.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/db/supabase-server";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "auth/session" });

export type PlatformRole = "USER" | "SUPER_ADMIN" | "HIPER_ADMIN";

export interface Session {
  userId: string;
  accountId: string;
  email: string;
  role: string;
  /** Platform-level role (independent of tenant role). */
  platformRole: PlatformRole;
  /** Whether the account has finished the onboarding wizard. */
  onboardingCompleted: boolean;
}

interface DbUserRow {
  id: string;
  email: string;
  name: string | null;
  platform_role?: PlatformRole;
}
interface DbMembershipRow {
  account_id: string;
  role: string;
  account: {
    id: string;
    onboarding_completed_at: string | null;
  } | null;
}

export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies();

    // Cookie-aware client just to read the supabase auth cookies that the
    // login / OAuth flow already wrote. Used ONLY to resolve the user id.
    const ssrClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            try {
              for (const { name, value, options } of cookiesToSet) {
                cookieStore.set(name, value, options);
              }
            } catch {
              // Server Component: cookie store is read-only. Ignore.
            }
          },
        },
      }
    );

    const {
      data: { user },
    } = await ssrClient.auth.getUser();
    if (!user) return null;

    const admin = getSupabaseAdmin();

    // 1. Find local user
    const { data: existing } = await admin
      .from("users")
      .select("id, email, name, supabase_id, platform_role")
      .eq("supabase_id", user.id)
      .maybeSingle();

    let dbUser: DbUserRow | null = existing
      ? {
          id: existing.id,
          email: existing.email,
          name: existing.name,
          platform_role: (existing.platform_role as PlatformRole) || "USER",
        }
      : null;

    // 2. If not found, look up by email (could be a manually-created user
    //    that hasn't been linked to a Supabase auth identity yet)
    if (!dbUser && user.email) {
      const { data: byEmail } = await admin
        .from("users")
        .select("id, email, name, platform_role")
        .eq("email", user.email)
        .maybeSingle();
      if (byEmail) {
        dbUser = {
          id: byEmail.id,
          email: byEmail.email,
          name: byEmail.name,
          platform_role: (byEmail.platform_role as PlatformRole) || "USER",
        };
        await admin
          .from("users")
          .update({ supabase_id: user.id })
          .eq("id", byEmail.id);
      }
    }

    // 3. Auto-provision a brand-new user + account + membership + AI config
    if (!dbUser) {
      const email = user.email || "";
      const name =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        email.split("@")[0] ||
        "User";

      const { account, user: created } = await provisionTenant({
        supabaseUserId: user.id,
        email,
        name,
      });
      dbUser = created;
      // Skip lookup — we already know the membership we just created.
      return {
        userId: dbUser.id,
        accountId: account.id,
        email: dbUser.email,
        role: "OWNER",
        platformRole: dbUser.platform_role || "USER",
        onboardingCompleted: !!account.onboarding_completed_at,
      };
    }

    // 4. Find the user's first membership + account
    const { data: membership } = await admin
      .from("account_members")
      .select(
        "account_id, role, account:accounts ( id, onboarding_completed_at )"
      )
      .eq("user_id", dbUser.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<DbMembershipRow>();

    if (!membership || !membership.account) {
      // User exists but has no account — provision a workspace for them.
      const { account } = await provisionTenant({
        supabaseUserId: user.id,
        email: dbUser.email,
        name: dbUser.name || dbUser.email.split("@")[0],
        existingUserId: dbUser.id,
      });
      return {
        userId: dbUser.id,
        accountId: account.id,
        email: dbUser.email,
        role: "OWNER",
        platformRole: dbUser.platform_role || "USER",
        onboardingCompleted: !!account.onboarding_completed_at,
      };
    }

    return {
      userId: dbUser.id,
      accountId: membership.account.id,
      email: dbUser.email,
      role: membership.role,
      platformRole: dbUser.platform_role || "USER",
      onboardingCompleted: !!membership.account.onboarding_completed_at,
    };
  } catch (err: unknown) {
    log.error("getSession failed", {
      err,
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// PROVISIONING — first-run tenant bootstrap (REST only)
// ─────────────────────────────────────────────────────────────

interface ProvisionInput {
  supabaseUserId: string;
  email: string;
  name: string;
  existingUserId?: string;
}

interface ProvisionedTenant {
  account: { id: string; onboarding_completed_at: string | null };
  user: DbUserRow;
}

async function provisionTenant(input: ProvisionInput): Promise<ProvisionedTenant> {
  const admin = getSupabaseAdmin();
  const slug =
    input.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 30) +
    "-" +
    Date.now().toString(36);

  // Use Supabase REST inserts. We can't do a multi-statement transaction over
  // REST, but the schema's foreign-key cascades + the fact that this only
  // runs on first sign-in make ordering correctness sufficient.

  const userId = input.existingUserId || cuid();
  if (!input.existingUserId) {
    const { error: userErr } = await admin.from("users").insert({
      id: userId,
      supabase_id: input.supabaseUserId,
      email: input.email,
      name: input.name,
    });
    if (userErr) throw new Error(`provision user failed: ${userErr.message}`);
  }

  const accountId = cuid();
  const { error: accErr } = await admin.from("accounts").insert({
    id: accountId,
    name: `${input.name}'s Workspace`,
    slug,
    plan: "FREE",
    locale: "pt",
    timezone: "America/Sao_Paulo",
  });
  if (accErr) throw new Error(`provision account failed: ${accErr.message}`);

  const { error: memErr } = await admin.from("account_members").insert({
    id: cuid(),
    account_id: accountId,
    user_id: userId,
    role: "OWNER",
  });
  if (memErr) throw new Error(`provision membership failed: ${memErr.message}`);

  const { error: cfgErr } = await admin.from("ai_configs").insert({
    id: cuid(),
    account_id: accountId,
    provider: "openai",
    model: "gpt-4o",
    system_prompt:
      "You are a professional sales assistant. Be natural, helpful, and guide leads toward conversion.",
    temperature: 0.7,
    max_tokens: 1000,
  });
  if (cfgErr) {
    // Non-fatal — ai_config can be created later in onboarding.
    log.warn("provision ai_config failed (non-fatal)", { err: cfgErr.message });
  }

  return {
    account: { id: accountId, onboarding_completed_at: null },
    user: { id: userId, email: input.email, name: input.name },
  };
}

/**
 * Lightweight cuid-like id generator (we don't need crypto-strong, just
 * collision-resistant for a few accounts/users per second).
 */
function cuid(): string {
  return (
    "c" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Destroy the current session by clearing Supabase auth cookies.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const all = cookieStore.getAll();
  for (const { name } of all) {
    if (name.startsWith("sb-")) {
      cookieStore.delete(name);
    }
  }
}
