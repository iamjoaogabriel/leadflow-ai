// src/app/api/health/schema/route.ts
//
// Schema-drift diagnostic. Hits each new column/table the app expects and
// reports which ones are missing. Use this to confirm whether the
// production DATABASE_URL is in sync with prisma/schema.prisma.
//
// Public endpoint by design (no secrets leaked) — only returns boolean
// presence flags. If you want to lock it, add a header check.

import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";

interface CheckResult {
  table: string;
  column?: string;
  ok: boolean;
  error?: string;
}

async function checkColumn(table: string, column: string): Promise<CheckResult> {
  try {
    // information_schema is portable across Postgres versions
    const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2`,
      table,
      column
    );
    const present = (rows[0]?.count ?? 0) > 0;
    return { table, column, ok: present };
  } catch (err) {
    return {
      table,
      column,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkTable(table: string): Promise<CheckResult> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      table
    );
    const present = (rows[0]?.count ?? 0) > 0;
    return { table, ok: present };
  } catch (err) {
    return {
      table,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkColumn("accounts", "onboarding_completed_at"),
    checkTable("meta_integrations"),
    checkTable("google_calendar_integrations"),
    checkColumn("conversations", "is_ai_enabled"),
    checkColumn("messages", "is_ai_generated"),
  ]);

  const missing = checks.filter((c) => !c.ok);
  const ok = missing.length === 0;

  return NextResponse.json(
    {
      ok,
      missing,
      checks,
      hint: ok
        ? "All expected columns/tables are present."
        : "Run `prisma db push` against your production DATABASE_URL or apply docs/rls.sql + ALTER TABLE statements manually.",
    },
    { status: ok ? 200 : 500 }
  );
}
