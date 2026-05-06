// src/app/api/onboarding/skip/route.ts
//
// Marks onboarding as completed without saving wizard data. Pure Supabase
// REST — no Prisma.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/db/supabase-server";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("accounts")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", session.accountId);
  if (error) {
    return NextResponse.json(
      { error: "internal_error", message: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
