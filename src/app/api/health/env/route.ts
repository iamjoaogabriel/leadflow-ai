// src/app/api/health/env/route.ts
//
// Reports which critical environment variables are present at runtime.
// Returns ONLY booleans — never the values themselves.
//
// In Coolify (and most Docker-based deploys) `NEXT_PUBLIC_*` vars are
// inlined at *build* time, but server-side `process.env.X` reads happen
// at *runtime*. If you set the variable in the Coolify UI but didn't
// expose it to the runtime container, this endpoint catches that gap.

import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, boolean> = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: !!process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: !!process.env.NEXT_PUBLIC_APP_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    REDIS_URL: !!process.env.REDIS_URL,
    EVOLUTION_API_URL: !!process.env.EVOLUTION_API_URL,
    EVOLUTION_API_KEY: !!process.env.EVOLUTION_API_KEY,
  };

  // Show URL host only (not credentials) so we can confirm it points
  // somewhere reasonable without leaking the project ref.
  const supabaseHost = (() => {
    try {
      return process.env.NEXT_PUBLIC_SUPABASE_URL
        ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
        : null;
    } catch {
      return "invalid_url";
    }
  })();

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL",
  ];
  const missing = required.filter((k) => !checks[k]);
  const ok = missing.length === 0;

  return NextResponse.json(
    {
      ok,
      missing,
      checks,
      supabaseHost,
      nodeEnv: process.env.NODE_ENV || null,
      hint: ok
        ? "All required runtime env vars are present."
        : "Set the missing vars in Coolify → Environment Variables and redeploy.",
    },
    { status: ok ? 200 : 500 }
  );
}
