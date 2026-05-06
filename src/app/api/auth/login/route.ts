// src/app/api/auth/login/route.ts
//
// Email/password login. Uses the SAME createServerClient that getSession()
// uses, so the cookies it sets are exactly what the rest of the app reads.
// (Earlier versions set sb-access-token/sb-refresh-token manually, but
// auth-helpers-nextjs writes its own cookie names like sb-<ref>-auth-token —
// the manual cookies were ignored, causing the post-login redirect loop.)

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import prisma from "@/lib/db/prisma";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "auth/login" });

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
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(rl.resetInMs / 1000)) },
      }
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
      return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          },
        },
      }
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      log.info("login failed", { email, reason: error?.message });
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 401 }
      );
    }

    // Cookies were already written by the supabase client via the setAll
    // callback above — nothing else to do here.

    // Resolve where to send the user after login
    const dbUser = await prisma.user.findUnique({
      where: { supabaseId: data.user.id },
      include: {
        memberships: {
          take: 1,
          include: {
            account: {
              select: { onboardingCompletedAt: true, locale: true },
            },
          },
        },
      },
    });
    const account = dbUser?.memberships[0]?.account;
    const accountLocale = account?.locale || "pt";
    const redirectTo = account?.onboardingCompletedAt
      ? `/${accountLocale}`
      : `/${accountLocale}/onboarding`;

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
