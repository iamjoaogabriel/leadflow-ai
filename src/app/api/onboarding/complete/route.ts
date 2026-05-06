// src/app/api/onboarding/complete/route.ts
//
// Saves the wizard answers into ai_configs.persona and marks the account's
// onboarding as completed. Pure Supabase REST — no Prisma.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/db/supabase-server";
import { logger } from "@/lib/logger";
import crypto from "crypto";

const log = logger.child({ module: "onboarding/complete" });

interface OnboardingPayload {
  template?: string;
  goal?: string;
  primaryChannel?: string;
  secondaryChannel?: string;
  firstContact?: string;
  aiName?: string;
  aiRole?: string;
  tone?: string;
  businessName?: string;
}

const VALID_TEMPLATES = [
  "form_lp",
  "whatsapp_direct",
  "quiz_external",
  "social_dm",
  "lp_followup",
  "manual_outbound",
];
const VALID_GOALS = [
  "close_sale",
  "schedule_meeting",
  "qualify_transfer",
  "collect_send",
];
const VALID_CHANNELS = ["WHATSAPP", "EMAIL", "SMS"];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as OnboardingPayload;

  if (!body.template || !VALID_TEMPLATES.includes(body.template)) {
    return NextResponse.json({ error: "invalid_template" }, { status: 400 });
  }
  if (!body.goal || !VALID_GOALS.includes(body.goal)) {
    return NextResponse.json({ error: "invalid_goal" }, { status: 400 });
  }
  const primary = body.primaryChannel || "WHATSAPP";
  if (!VALID_CHANNELS.includes(primary)) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  try {
    // Read existing persona so we don't overwrite unrelated fields
    const { data: existing } = await admin
      .from("ai_configs")
      .select("id, system_prompt, persona")
      .eq("account_id", session.accountId)
      .maybeSingle();

    const existingPersona =
      (existing?.persona as Record<string, unknown> | null) || {};

    const webhookId =
      (existingPersona.pipelineWebhookId as string) ||
      crypto.randomBytes(16).toString("hex");

    const persona: Record<string, unknown> = {
      ...existingPersona,
      pipelineTemplate: body.template,
      pipelineGoal: body.goal,
      pipelinePrimaryChannel: primary,
      pipelineSecondaryChannel: body.secondaryChannel || "",
      pipelineFirstContact: body.firstContact || "immediate",
      pipelineWebhookId: webhookId,
      aiName: body.aiName || existingPersona.aiName || "Sofia",
      aiRole: body.aiRole || existingPersona.aiRole || "Consultor de vendas",
      tone: body.tone || existingPersona.tone || "professional_friendly",
    };

    if (existing?.id) {
      const { error } = await admin
        .from("ai_configs")
        .update({
          persona,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) throw new Error(`update ai_config failed: ${error.message}`);
    } else {
      const { error } = await admin.from("ai_configs").insert({
        id: cuid(),
        account_id: session.accountId,
        provider: "openai",
        model: "gpt-4o",
        system_prompt:
          "Você é um assistente de vendas inteligente. Engaje leads de forma natural e profissional, entenda suas necessidades e guie-os para a conversão. Nunca invente informações.",
        temperature: 0.7,
        max_tokens: 1000,
        persona,
      });
      if (error) throw new Error(`insert ai_config failed: ${error.message}`);
    }

    const accountUpdate: Record<string, unknown> = {
      onboarding_completed_at: new Date().toISOString(),
    };
    if (body.businessName && body.businessName.trim()) {
      accountUpdate.name = body.businessName.trim();
    }
    const { error: accErr } = await admin
      .from("accounts")
      .update(accountUpdate)
      .eq("id", session.accountId);
    if (accErr) throw new Error(`update account failed: ${accErr.message}`);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    log.error("onboarding complete failed", { err });
    const msg = err instanceof Error ? err.message : "internal_error";
    return NextResponse.json(
      { error: "internal_error", message: msg },
      { status: 500 }
    );
  }
}

function cuid(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
