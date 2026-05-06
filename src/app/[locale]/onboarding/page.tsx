// src/app/[locale]/onboarding/page.tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/db/supabase-server";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);

  // Already completed → send user to dashboard
  if (session.onboardingCompleted) redirect(`/${locale}`);

  const admin = getSupabaseAdmin();
  const [accountRes, userRes, aiConfigRes] = await Promise.all([
    admin
      .from("accounts")
      .select("name")
      .eq("id", session.accountId)
      .maybeSingle(),
    admin
      .from("users")
      .select("name, email")
      .eq("id", session.userId)
      .maybeSingle(),
    admin
      .from("ai_configs")
      .select("persona")
      .eq("account_id", session.accountId)
      .maybeSingle(),
  ]);

  const account = accountRes.data;
  const user = userRes.data;
  const persona =
    (aiConfigRes.data?.persona as Record<string, unknown>) || {};

  return (
    <OnboardingWizard
      userName={user?.name || user?.email?.split("@")[0] || "por aí"}
      accountName={account?.name || ""}
      initialPersona={{
        pipelineTemplate: String(persona.pipelineTemplate || ""),
        pipelineGoal: String(persona.pipelineGoal || ""),
        pipelinePrimaryChannel: String(
          persona.pipelinePrimaryChannel || "WHATSAPP"
        ),
        aiName: String(persona.aiName || ""),
        aiRole: String(persona.aiRole || ""),
        tone: String(persona.tone || "professional_friendly"),
      }}
    />
  );
}
