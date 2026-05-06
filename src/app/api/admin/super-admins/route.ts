// src/app/api/admin/super-admins/route.ts
//
// HIPER_ADMIN-only management of platform Super Admins.
//
// GET    → list current super admins (and the hiper admin)
// POST   → promote an existing user to SUPER_ADMIN by email, or create
//          a new auth user if not found
// DELETE → demote a super admin back to USER (?id=xxx)

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db/supabase-server";
import {
  requireHiperAdmin,
  AdminAuthError,
  generatePassword,
  buildInviteMessage,
} from "@/lib/admin/platform";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "admin/super-admins" });

export async function GET() {
  try {
    await requireHiperAdmin();
    const sb = getSupabaseAdmin();

    // List of users with platform role >= SUPER_ADMIN
    const { data: users, error } = await sb
      .from("users")
      .select("id, name, email, platform_role, created_at")
      .in("platform_role", ["SUPER_ADMIN", "HIPER_ADMIN"])
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Count how many tenants each one created
    const ids = (users || []).map((u) => u.id);
    const counts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: rows } = await sb
        .from("accounts")
        .select("created_by_id")
        .in("created_by_id", ids);
      for (const r of rows || []) {
        const k = r.created_by_id as string;
        counts[k] = (counts[k] || 0) + 1;
      }
    }

    return NextResponse.json({
      users: (users || []).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        platformRole: u.platform_role,
        createdAt: u.created_at,
        tenantCount: counts[u.id] || 0,
      })),
    });
  } catch (err) {
    return mapError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireHiperAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    if (!name || name.length < 2) {
      return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();

    // 1. If a user with this email already exists locally, just promote.
    const { data: existing } = await sb
      .from("users")
      .select("id, supabase_id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const { error } = await sb
        .from("users")
        .update({ platform_role: "SUPER_ADMIN", name })
        .eq("id", existing.id);
      if (error) throw error;
      return NextResponse.json({
        promoted: true,
        userId: existing.id,
        email,
      });
    }

    // 2. Create a brand-new auth user with a generated password
    const password = generatePassword();
    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (authError || !authData.user) throw authError || new Error("create_failed");

    const userId = cuid();
    const { error: insErr } = await sb.from("users").insert({
      id: userId,
      supabase_id: authData.user.id,
      email,
      name,
      platform_role: "SUPER_ADMIN",
    });
    if (insErr) throw insErr;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app";
    const message = buildInviteMessage({
      appUrl,
      companyName: "Marketing Digital AI",
      ownerName: name,
      email,
      password,
      locale: "pt",
    });

    return NextResponse.json({
      created: true,
      userId,
      email,
      password,
      message,
      loginUrl: `${appUrl}/login`,
    });
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const me = await requireHiperAdmin();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
    if (id === me.userId)
      return NextResponse.json({ error: "cannot_demote_self" }, { status: 400 });

    const sb = getSupabaseAdmin();

    // Don't allow demoting another hiper admin
    const { data: target } = await sb
      .from("users")
      .select("platform_role")
      .eq("id", id)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (target.platform_role === "HIPER_ADMIN") {
      return NextResponse.json({ error: "cannot_demote_hiper" }, { status: 400 });
    }

    const { error } = await sb
      .from("users")
      .update({ platform_role: "USER" })
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ demoted: true, id });
  } catch (err) {
    return mapError(err);
  }
}

// ── helpers ───────────────────────────────────────────────────

function cuid(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function mapError(err: unknown): NextResponse {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.code }, { status: err.status });
  }
  log.error("super-admins handler crashed", { err });
  const msg = err instanceof Error ? err.message : "internal_error";
  return NextResponse.json(
    { error: "internal_error", message: msg },
    { status: 500 }
  );
}
