// src/app/api/health/db/route.ts
//
// Tries the simplest possible Prisma query and reports a useful error
// when it fails. Common Supabase pooler errors:
//
//  - "Tenant or user not found"  → username must be `postgres.<projectRef>`
//                                   on the transaction pooler (port 6543)
//  - "ENOTFOUND"                  → wrong host / typo
//  - "password authentication failed" → wrong password
//  - "EMAXCONNSESSION"            → using session-mode pooler with too many
//                                   parallel queries (use transaction pool)

import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";

export async function GET() {
  const t0 = Date.now();
  try {
    const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() AS now`;
    const usersCount = await prisma.user.count();
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - t0,
      now: rows[0]?.now,
      usersCount,
      databaseHost: hostFromUrl(process.env.DATABASE_URL),
      directHost: hostFromUrl(process.env.DIRECT_URL),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = explain(message);
    return NextResponse.json(
      {
        ok: false,
        latencyMs: Date.now() - t0,
        error: message,
        hint,
        databaseHost: hostFromUrl(process.env.DATABASE_URL),
        directHost: hostFromUrl(process.env.DIRECT_URL),
      },
      { status: 500 }
    );
  }
}

function hostFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}:${u.port}`;
  } catch {
    return "invalid_url";
  }
}

function explain(msg: string): string {
  if (/Tenant or user not found/i.test(msg)) {
    return "Supabase pooler rejected the user. Username must be `postgres.<project_ref>` on the transaction pooler (port 6543), not just `postgres`. Check Supabase → Settings → Database → Connection string → Transaction pooler and copy the URI verbatim.";
  }
  if (/EMAXCONNSESSION/i.test(msg)) {
    return "Connection pool exhausted. Make sure DATABASE_URL points to the **transaction** pooler (port 6543) and includes `?pgbouncer=true&connection_limit=10`.";
  }
  if (/password authentication failed/i.test(msg)) {
    return "Wrong password. Reset it in Supabase → Settings → Database → Reset database password.";
  }
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
    return "Host not resolvable. Check the hostname for typos.";
  }
  return "Unrecognized DB error. Inspect the error message above.";
}
