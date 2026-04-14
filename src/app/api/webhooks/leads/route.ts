// src/app/api/webhooks/leads/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { processNewLead } from "@/lib/ai/engine";

/**
 * Webhook endpoint to receive leads from external sources.
 * Supports: Typeform, Google Forms, Meta Lead Ads, custom forms.
 *
 * URL format: /api/webhooks/leads?key=<webhook_id>
 *
 * Expected JSON body (flexible):
 * {
 *   "name": "Lead Name",
 *   "email": "lead@email.com",
 *   "phone": "+5511999999999",
 *   "source": "typeform|google_forms|meta|custom",
 *   "campaign": "Campaign Name",
 *   "metadata": { ... any extra fields }
 * }
 *
 * Also supports Typeform webhook format (auto-detected).
 */
export async function POST(req: NextRequest) {
  try {
    const webhookKey = new URL(req.url).searchParams.get("key");
    if (!webhookKey) return NextResponse.json({ error: "Missing webhook key" }, { status: 400 });

    // Find account by webhook key
    const aiConfig = await prisma.aIConfig.findFirst({
      where: { persona: { path: ["pipelineWebhookId"], equals: webhookKey } },
    });

    if (!aiConfig) return NextResponse.json({ error: "Invalid webhook key" }, { status: 401 });
    const accountId = aiConfig.accountId;

    const body = await req.json();

    // ── Normalize data from different sources ──
    let leadData = normalizeLeadData(body);

    if (!leadData.name && !leadData.email && !leadData.phone) {
      return NextResponse.json({ error: "At least name, email or phone required" }, { status: 400 });
    }

    // ── Find or match campaign ──
    let campaignId: string | null = null;
    if (leadData.campaign) {
      const campaign = await prisma.campaign.findFirst({
        where: { accountId, name: { contains: leadData.campaign, mode: "insensitive" } },
      });
      if (campaign) campaignId = campaign.id;
    }

    // ── Create lead ──
    const lead = await prisma.lead.create({
      data: {
        id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: leadData.name || null,
        email: leadData.email || null,
        phone: leadData.phone || null,
        countryCode: leadData.countryCode || null,
        source: "MARKETING",
        status: "NEW",
        score: 0,
        metadata: leadData.metadata || {},
        campaignId,
        accountId,
        updatedAt: new Date(),
      },
    });

    // ── Update campaign lead count ──
    if (campaignId) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { totalLeads: { increment: 1 } },
      });
    }

    // ── Trigger AI processing (async, don't await) ──
    const persona = (aiConfig.persona as any) || {};
    processNewLead({
      leadId: lead.id,
      accountId,
      systemPrompt: aiConfig.systemPrompt,
      persona,
      temperature: aiConfig.temperature,
    }).catch(err => console.error("[Webhook] processNewLead error:", err));

    return NextResponse.json({ success: true, leadId: lead.id });
  } catch (e: any) {
    console.error("[Webhook] Error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Also accept GET for webhook verification (Typeform, Meta)
export async function GET(req: NextRequest) {
  const challenge = new URL(req.url).searchParams.get("hub.challenge");
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ status: "ok", message: "Webhook endpoint active" });
}

/* ═══ NORMALIZE DATA FROM DIFFERENT SOURCES ═══ */
function normalizeLeadData(body: any): {
  name: string | null; email: string | null; phone: string | null;
  countryCode: string | null; campaign: string | null; metadata: any;
} {
  // ── Typeform format ──
  if (body.form_response) {
    const answers = body.form_response.answers || [];
    const hidden = body.form_response.hidden || {};
    return {
      name: findAnswer(answers, ["name", "nome", "nombre", "short_text"]) || hidden.name || null,
      email: findAnswer(answers, ["email", "e-mail"]) || hidden.email || null,
      phone: findAnswer(answers, ["phone", "telefone", "whatsapp", "celular", "tel"]) || hidden.phone || null,
      countryCode: hidden.country || null,
      campaign: hidden.campaign || hidden.utm_campaign || null,
      metadata: { source: "typeform", formId: body.form_response.form_id, ...hidden },
    };
  }

  // ── Meta Lead Ads format ──
  if (body.entry && body.entry[0]?.changes) {
    const change = body.entry[0].changes[0];
    if (change?.field === "leadgen") {
      const leadgenId = change.value?.leadgen_id;
      return {
        name: null, email: null, phone: null, countryCode: null,
        campaign: null,
        metadata: { source: "meta_leadgen", leadgenId, pageId: body.entry[0].id, raw: change.value },
      };
    }
  }

  // ── Standard format ──
  return {
    name: body.name || body.nome || body.full_name || body.fullName || null,
    email: body.email || body.e_mail || null,
    phone: body.phone || body.telefone || body.whatsapp || body.cel || body.mobile || null,
    countryCode: body.country_code || body.countryCode || body.country || null,
    campaign: body.campaign || body.campanha || body.utm_campaign || null,
    metadata: { source: body.source || "webhook", ...(body.metadata || {}), raw: body },
  };
}

function findAnswer(answers: any[], keywords: string[]): string | null {
  for (const a of answers) {
    const fieldTitle = (a.field?.ref || a.field?.id || "").toLowerCase();
    const fieldType = a.type;
    if (keywords.some(k => fieldTitle.includes(k)) || keywords.includes(fieldType)) {
      if (a.type === "email") return a.email;
      if (a.type === "phone_number") return a.phone_number;
      if (a.type === "short_text" || a.type === "long_text") return a.text;
      if (a.type === "number") return String(a.number);
    }
  }
  return null;
}