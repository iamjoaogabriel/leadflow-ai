// src/app/[locale]/(dashboard)/layout.tsx
import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/db/prisma";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "dashboard/layout" });

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  // Gate onboarding: first-time accounts must finish the wizard before
  // landing on the dashboard. Wrapped in try/catch because a schema drift
  // (missing column in production) would otherwise show "Application error"
  // to the user. We log the actual error and bounce them to login with a
  // queryable error code so support can debug from the URL alone.
  try {
    const account = await prisma.account.findUnique({
      where: { id: session.accountId },
      select: { onboardingCompletedAt: true },
    });
    if (!account?.onboardingCompletedAt) {
      redirect(`/${locale}/onboarding`);
    }
  } catch (err: unknown) {
    // `redirect()` throws a NEXT_REDIRECT signal that must propagate
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    log.error("dashboard gate failed", {
      err,
      accountId: session.accountId,
      hint: "If the column 'onboarding_completed_at' is missing in production, run `prisma db push` against the production DATABASE_URL.",
    });
    // Bounce to login with a debuggable code instead of showing the
    // generic Next.js application error page.
    redirect(`/${locale}/login?error=schema_drift`);
  }

  return <DashboardShell>{children}</DashboardShell>;
}
