// src/app/[locale]/(dashboard)/layout.tsx
import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DashboardShell } from "@/components/layout/dashboard-shell";

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

  // The session resolver already returns onboardingCompleted — no extra
  // database round-trip needed.
  if (!session.onboardingCompleted) {
    redirect(`/${locale}/onboarding`);
  }

  return <DashboardShell>{children}</DashboardShell>;
}
