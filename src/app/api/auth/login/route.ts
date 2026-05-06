// src/app/api/auth/login/route.ts
//
// Email/password login. Uses @supabase/ssr to set the auth cookies in the
// exact same format getSession() reads. NO Prisma — the dashboard layout
// is the single source of truth for onboarding redirect.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "auth/login" });

export async function POST(req: NextRequest) {
  // Rate limit: 10 attempts per minute per IP
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
      locale?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const locale = body.locale || "pt";

    if (!email || !password) {
      return NextResponse.json(
        { error: "missing_credentials" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
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
    // callback. The dashboard layout decides whether to send the user
    // to /onboarding or /[locale] based on their account state.
    return NextResponse.json({
      success: true,
      redirectTo: `/${locale}`,
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
