// src/app/api/auth/login/route.ts
//
// Email/password login. Authenticates against Supabase Auth (the same
// system the OAuth callback uses), sets the SSR cookies and decides where
// to redirect based on whether the account already finished onboarding.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import prisma from "@/lib/db/prisma";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "auth/login" });

let _supabase: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabase;
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 login attempts per minute per IP
  const rl = await rateLimit({
    key: `login:${getClientIp(req)}`,
    max: 10,
    windowSec: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.resetInMs / 1000)) } }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "missing_credentials" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin().auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      log.info("login failed", { email, reason: error?.message || "no_session" });
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 401 }
      );
    }

    // Find local user / account so we know where to redirect
    const dbUser = await prisma.user.findUnique({
      where: { supabaseId: data.user.id },
      include: {
        memberships: {
          take: 1,
          include: { account: { select: { onboardingCompletedAt: true, locale: true } } },
        },
      },
    });

    const account = dbUser?.memberships[0]?.account;
    const accountLocale = account?.locale || "pt";
    const onboardingDone = !!account?.onboardingCompletedAt;
    const redirectTo = onboardingDone
      ? `/${accountLocale}`
      : `/${accountLocale}/onboarding`;

    // Set SSR cookies — same names the middleware reads
    const cookieStore = await cookies();
    const secure = process.env.NODE_ENV === "production";
    cookieStore.set("sb-access-token", data.session.access_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 60 * 60,
      path: "/",
    });
    cookieStore.set("sb-refresh-token", data.session.refresh_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return NextResponse.json({
      success: true,
      redirectTo,
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (err: unknown) {
    log.error("login crashed", { err });
    const msg = err instanceof Error ? err.message : "internal_error";
    return NextResponse.json(
      { error: "internal_error", message: msg },
      { status: 500 }
    );
  }
}
