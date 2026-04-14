// src/app/api/pipeline/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import crypto from "crypto";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const config = await prisma.aIConfig.findUnique({ where: { accountId: session.accountId } });
    if (!config) return NextResponse.json({});
    const p = (config.persona as any) || {};
    return NextResponse.json({
      template: p.pipelineTemplate || "",
      goal: p.pipelineGoal || "",
      firstContact: p.pipelineFirstContact || "immediate",
      primaryChannel: p.pipelinePrimaryChannel || "WHATSAPP",
      secondaryChannel: p.pipelineSecondaryChannel || "",
      transferPhone: p.pipelineTransferPhone || "",
      transferMessage: p.pipelineTransferMessage || "",
      calendarEnabled: p.pipelineCalendarEnabled || false,
      calendarEmail: p.pipelineCalendarEmail || "",
      followUpEnabled: p.pipelineFollowUpEnabled ?? true,
      followUpAttempts: p.pipelineFollowUpAttempts ?? 3,
      followUpInterval: p.pipelineFollowUpInterval ?? 24,
      humanApproval: p.pipelineHumanApproval || false,
      webhookId: p.pipelineWebhookId || "",
    });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const existing = await prisma.aIConfig.findUnique({ where: { accountId: session.accountId } });
    const existingPersona = (existing?.persona as any) || {};

    // Generate webhook ID if not present
    const webhookId = existingPersona.pipelineWebhookId || crypto.randomBytes(16).toString("hex");

    const persona = {
      ...existingPersona,
      pipelineTemplate: body.template,
      pipelineGoal: body.goal,
      pipelineFirstContact: body.firstContact,
      pipelinePrimaryChannel: body.primaryChannel,
      pipelineSecondaryChannel: body.secondaryChannel,
      pipelineTransferPhone: body.transferPhone,
      pipelineTransferMessage: body.transferMessage,
      pipelineCalendarEnabled: body.calendarEnabled,
      pipelineCalendarEmail: body.calendarEmail,
      pipelineFollowUpEnabled: body.followUpEnabled,
      pipelineFollowUpAttempts: body.followUpAttempts,
      pipelineFollowUpInterval: body.followUpInterval,
      pipelineHumanApproval: body.humanApproval,
      pipelineWebhookId: webhookId,
    };

    await prisma.aIConfig.upsert({
      where: { accountId: session.accountId },
      create: { accountId: session.accountId, provider: "openai", model: "gpt-4o", systemPrompt: "", temperature: 0.7, maxTokens: 500, persona },
      update: { persona, updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, webhookId });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}