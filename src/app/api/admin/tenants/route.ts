// src/app/api/admin/tenants/route.ts
//
// Tenant management for Super Admins (and Hiper Admin).
//
// GET    → list tenants. SUPER_ADMIN sees only tenants they created.
//          HIPER_ADMIN sees everything, with the creator embedded.
// POST   → create a new tenant: provisions auth user + local user +
//          account + membership + ai_config. Returns generated password
//          and a ready-to-paste invite message.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db/supabase-server";
import {
  requireSuperAdminOrHigher,
  AdminAuthError,
  generatePassword,
  buildInviteMessage,
  isHiperAdmin,
} from "@/lib/admin/platform";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "admin/tenants" });

interface CreateTenantBody {
  companyName?: string;
  ownerName?: string;
  ownerEmail?: string;
  password?: string;
  maxUsers?: number;
  plan?: "FREE" | "STARTER" | "PRO" | "ENTERPRISE";
  locale?: "pt" | "en" | "es";
}

export async function GET() {
  try {
    const me = await requireSuperAdminOrHigher();
    const sb = getSupabaseAdmin();

    // Hiper admin sees all; super admin sees only their own.
    let query = sb
      .from("accounts")
      .select(
        "id, name, slug, plan, max_users, onboarding_completed_at, created_at, created_by_id"
      )
      .order("created_at", { ascending: false });

    if (!isHiperAdmin(me)) {
      query = query.eq("created_by_id", me.userId);
    }

    const { data: accounts, error } = await query;
    if (error) throw error;

    const accountIds = (accounts || []).map((a) => a.id);

    // Count members per account in one round-trip
    const memberCounts: Record<string, number> = {};
    if (accountIds.length > 0) {
      const { data: members } = await sb
        .from("account_members")
        .select("account_id")
        .in("account_id", accountIds);
      for (const m of members || []) {
        memberCounts[m.account_id] = (memberCounts[m.account_id] || 0) + 1;
      }
    }

    // Resolve creator names (only for hiper admin view)
    let creators: Record<string, { name: string | null; email: string }> = {};
    if (isHiperAdmin(me)) {
      const creatorIds = Array.from(
        new Set((accounts || []).map((a) => a.created_by_id).filter(Boolean) as string[])
      );
      if (creatorIds.length > 0) {
        const { data: users } = await sb
          .from("users")
          .select("id, name, email")
          .in("id", creatorIds);
        creators = Object.fromEntries(
          (users || []).map((u) => [u.id, { name: u.name, email: u.email }])
        );
      }
    }

    return NextResponse.json({
      tenants: (accounts || []).map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        plan: a.plan,
        maxUsers: a.max_users,
        memberCount: memberCounts[a.id] || 0,
        onboardingCompleted: !!a.onboarding_completed_at,
        createdAt: a.created_at,
        createdById: a.created_by_id,
        creator: a.created_by_id ? creators[a.created_by_id] || null : null,
      })),
      isHiperAdmin: isHiperAdmin(me),
    });
  } catch (err) {
    return mapError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireSuperAdminOrHigher();
    const body = (await req.json().catch(() => ({}))) as CreateTenantBody;

    const companyName = (body.companyName || "").trim();
    const ownerName = (body.ownerName || "").trim();
    const ownerEmail = (body.ownerEmail || "").trim().toLowerCase();
    const maxUsers = clampInt(body.maxUsers ?? 5, 1, 200);
    const plan: CreateTenantBody["plan"] = body.plan || "STARTER";
    const locale = body.locale || "pt";

    if (companyName.length < 2)
      return NextResponse.json({ error: "invalid_company_name" }, { status: 400 });
    if (ownerName.length < 2)
      return NextResponse.json({ error: "invalid_owner_name" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))
      return NextResponse.json({ error: "invalid_owner_email" }, { status: 400 });

    const password = body.password?.trim() || generatePassword();
    if (password.length < 8)
      return NextResponse.json({ error: "weak_password" }, { status: 400 });

    const sb = getSupabaseAdmin();

    // 1. Reject if email already exists
    const { data: dup } = await sb
      .from("users")
      .select("id")
      .eq("email", ownerEmail)
      .maybeSingle();
    if (dup)
      return NextResponse.json(
        { error: "email_already_exists" },
        { status: 409 }
      );

    // 2. Create Supabase auth user
    const { data: authData, error: authError } =
      await sb.auth.admin.createUser({
        email: ownerEmail,
        password,
        email_confirm: true,
        user_metadata: { name: ownerName, company: companyName },
      });
    if (authError || !authData.user) {
      throw authError || new Error("auth_creation_failed");
    }

    // 3. Create local rows (user → account → membership → ai_config)
    const userId = cuid();
    const accountId = cuid();
    const slug = makeSlug(companyName);

    const { error: uErr } = await sb.from("users").insert({
      id: userId,
      supabase_id: authData.user.id,
      email: ownerEmail,
      name: ownerName,
      platform_role: "USER",
    });
    if (uErr) throw uErr;

    const { error: aErr } = await sb.from("accounts").insert({
      id: accountId,
      name: companyName,
      slug,
      plan,
      locale,
      timezone: "America/Sao_Paulo",
      max_users: maxUsers,
      created_by_id: me.userId,
    });
    if (aErr) throw aErr;

    const { error: mErr } = await sb.from("account_members").insert({
      id: cuid(),
      account_id: accountId,
      user_id: userId,
      role: "OWNER",
    });
    if (mErr) throw mErr;

    const { error: cfgErr } = await sb.from("ai_configs").insert({
      id: cuid(),
      account_id: accountId,
      provider: "openai",
      model: "gpt-4o",
      system_prompt:
        "Você é um assistente de vendas profissional. Atenda os leads com naturalidade, entenda a necessidade e conduza ao próximo passo.",
      temperature: 0.7,
      max_tokens: 1000,
    });
    if (cfgErr) {
      log.warn("ai_config insert failed (non-fatal)", { err: cfgErr });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app";
    const message = buildInviteMessage({
      appUrl,
      companyName,
      ownerName,
      email: ownerEmail,
      password,
      locale,
    });

    return NextResponse.json(
      {
        ok: true,
        tenant: {
          id: accountId,
          name: companyName,
          slug,
          plan,
          maxUsers,
        },
        owner: {
          id: userId,
          email: ownerEmail,
          name: ownerName,
        },
        credentials: {
          email: ownerEmail,
          password,
          loginUrl: `${appUrl}/login`,
        },
        message,
      },
      { status: 201 }
    );
  } catch (err) {
    return mapError(err);
  }
}

// ── helpers ───────────────────────────────────────────────────

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function makeSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) +
    "-" +
    Date.now().toString(36)
  );
}

function cuid(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function mapError(err: unknown): NextResponse {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.code }, { status: err.status });
  }
  log.error("tenants handler crashed", { err });
  const msg = err instanceof Error ? err.message : "internal_error";
  return NextResponse.json(
    { error: "internal_error", message: msg },
    { status: 500 }
  );
}
