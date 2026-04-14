// src/lib/ai/engine.ts
/**
 * AI Sales Engine — Core processor for lead conversations.
 *
 * Flow:
 * 1. Lead arrives (webhook or WhatsApp message)
 * 2. Engine checks pipeline config (proactive/reactive, timing, channel)
 * 3. Creates or resumes conversation
 * 4. Generates AI response using OpenAI with account's system prompt
 * 5. Sends via configured channel (WhatsApp/Email/SMS)
 * 6. Schedules follow-up if no response
 * 7. Handles transfer to human when needed
 */

import prisma from "@/lib/db/prisma";
import { sendWhatsApp, sendEmail, sendSMS } from "./channels";

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

/* ═══ TYPES ═══ */
interface ProcessLeadParams {
  leadId: string;
  accountId: string;
  systemPrompt: string;
  persona: any;
  temperature: number;
}

interface ProcessMessageParams {
  conversationId: string;
  incomingMessage: string;
  accountId: string;
}

/* ═══ PROCESS NEW LEAD (proactive first contact) ═══ */
export async function processNewLead(params: ProcessLeadParams) {
  const { leadId, accountId, systemPrompt, persona, temperature } = params;

  const pipeline = extractPipeline(persona);
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  // Check if proactive (AI contacts first)
  const isProactive = ["form_lp", "quiz_external", "lp_followup", "manual_outbound"].includes(pipeline.template);
  if (!isProactive) return; // Reactive: wait for lead to message

  // Calculate delay
  const delayMs = getDelayMs(pipeline.firstContact);

  // Schedule first contact
  if (delayMs > 0) {
    setTimeout(() => executeFirstContact(leadId, accountId, systemPrompt, persona, temperature), delayMs);
  } else {
    await executeFirstContact(leadId, accountId, systemPrompt, persona, temperature);
  }
}

async function executeFirstContact(
  leadId: string, accountId: string, systemPrompt: string, persona: any, temperature: number
) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  const pipeline = extractPipeline(persona);

  // Create conversation
  const conversation = await prisma.conversation.create({
    data: {
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      leadId, accountId, channel: pipeline.primaryChannel as any,
      channelIdentifier: lead.phone || lead.email || null,
      isActive: true, isAiEnabled: true, updatedAt: new Date(),
    },
  });

  // Generate first message
  const leadContext = buildLeadContext(lead);
  const firstMessage = await generateAIResponse(systemPrompt, [
    { role: "system", content: `A new lead just arrived. Send your FIRST message to start the conversation. Be warm but brief. Lead info:\n${leadContext}` },
  ], temperature);

  if (!firstMessage) return;

  // Save message
  await saveMessage(conversation.id, accountId, firstMessage, "OUTBOUND", true);

  // Send via channel
  await sendViaChannel(pipeline.primaryChannel, lead, firstMessage, accountId);

  // Update lead status
  await prisma.lead.update({ where: { id: leadId }, data: { status: "CONTACTED", lastContactAt: new Date(), updatedAt: new Date() } });

  // Schedule follow-up
  if (pipeline.followUpEnabled) {
    scheduleFollowUp(conversation.id, accountId, pipeline, 1);
  }
}

/* ═══ PROCESS INCOMING MESSAGE (reactive or continuation) ═══ */
export async function processIncomingMessage(params: ProcessMessageParams) {
  const { conversationId, incomingMessage, accountId } = params;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { lead: true },
  });
  if (!conversation || !conversation.isAIEnabled) return null;

  // Load AI config
  const aiConfig = await prisma.aIConfig.findUnique({ where: { accountId } });
  if (!aiConfig) return null;

  const persona = (aiConfig.persona as any) || {};
  const pipeline = extractPipeline(persona);

  // Save incoming message
  await saveMessage(conversationId, accountId, incomingMessage, "INBOUND", false);

  // Load conversation history
  const history = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 30, // Last 30 messages for context
  });

  // Build messages array for OpenAI
  const messages: { role: string; content: string }[] = history.map(m => ({
    role: m.direction === "INBOUND" ? "user" : "assistant",
    content: m.content,
  }));

  // Check for transfer triggers
  if (shouldTransfer(incomingMessage, pipeline)) {
    return await handleTransfer(conversation, pipeline, accountId);
  }

  // Generate AI response
  const aiResponse = await generateAIResponse(
    aiConfig.systemPrompt, messages, aiConfig.temperature
  );

  if (!aiResponse) return null;

  // Save AI response
  await saveMessage(conversationId, accountId, aiResponse, "OUTBOUND", true);

  // Send via channel
  await sendViaChannel(pipeline.primaryChannel, conversation.lead, aiResponse, accountId);

  // Update conversation
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), updatedAt: new Date() },
  });

  // Update lead
  await prisma.lead.update({
    where: { id: conversation.leadId },
    data: { status: "IN_CONVERSATION", lastContactAt: new Date(), updatedAt: new Date() },
  });

  return aiResponse;
}

/* ═══ PROCESS WHATSAPP INCOMING (entry point from Evolution API webhook) ═══ */
export async function processWhatsAppIncoming(accountId: string, phone: string, message: string) {
  // Find or create lead + conversation
  let lead = await prisma.lead.findFirst({
    where: { accountId, phone: { contains: phone.replace("+", "") } },
  });

  if (!lead) {
    // New lead from WhatsApp (reactive flow)
    lead = await prisma.lead.create({
      data: {
        id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        phone, source: "MARKETING", status: "NEW", score: 0,
        accountId, updatedAt: new Date(),
      },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { leadId: lead.id, accountId, isActive: true },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        leadId: lead.id, accountId, channel: "WHATSAPP",
        channelIdentifier: phone, isActive: true, isAiEnabled: true,
        updatedAt: new Date(),
      },
    });
  }

  return processIncomingMessage({
    conversationId: conversation.id,
    incomingMessage: message,
    accountId,
  });
}

/* ═══ AI RESPONSE GENERATION ═══ */
async function generateAIResponse(
  systemPrompt: string,
  messages: { role: string; content: string }[],
  temperature: number
): Promise<string | null> {
  if (!OPENAI_KEY) { console.error("[Engine] No OPENAI_API_KEY"); return null; }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature,
        max_tokens: 300,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    if (!response.ok) { console.error("[Engine] OpenAI error:", response.status); return null; }
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e: any) {
    console.error("[Engine] OpenAI fetch error:", e.message);
    return null;
  }
}

/* ═══ CHANNEL ROUTING ═══ */
async function sendViaChannel(channel: string, lead: any, message: string, accountId: string) {
  try {
    const channelConfig = await prisma.channel.findFirst({
      where: { accountId, type: channel as any, isEnabled: true },
    });
    if (!channelConfig) {
      console.warn(`[Engine] Channel ${channel} not configured for account ${accountId}`);
      return;
    }
    const cfg = channelConfig.config as any;

    switch (channel) {
      case "WHATSAPP":
        if (lead.phone) await sendWhatsApp(lead.phone, message, cfg, accountId);
        break;
      case "EMAIL":
        if (lead.email) await sendEmail(lead.email, lead.name || "Lead", message, cfg);
        break;
      case "SMS":
        if (lead.phone) await sendSMS(lead.phone, message, cfg);
        break;
    }
  } catch (e: any) {
    console.error(`[Engine] Send ${channel} error:`, e.message);
  }
}

/* ═══ TRANSFER TO HUMAN ═══ */
function shouldTransfer(message: string, pipeline: any): boolean {
  const lowerMsg = message.toLowerCase();
  const transferKeywords = [
    "falar com humano", "falar com alguém", "atendente", "pessoa real",
    "talk to human", "real person", "agent", "hablar con alguien",
    "reclamação", "complaint", "queja", "problema grave",
  ];
  return transferKeywords.some(k => lowerMsg.includes(k));
}

async function handleTransfer(conversation: any, pipeline: any, accountId: string) {
  const transferMsg = pipeline.transferMessage || "Vou te conectar com nosso time agora. Um momento!";

  // Save transfer message
  await saveMessage(conversation.id, accountId, transferMsg, "OUTBOUND", true);

  // Send to lead
  await sendViaChannel(pipeline.primaryChannel, conversation.lead, transferMsg, accountId);

  // Disable AI on this conversation
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { isAiEnabled: false, updatedAt: new Date() },
  });

  // Notify human (if transfer phone configured)
  if (pipeline.transferPhone) {
    const notifyMsg = `🔔 Lead transferido: ${conversation.lead.name || conversation.lead.phone || conversation.lead.email}. Conversa: ${conversation.id}`;
    const channelConfig = await prisma.channel.findFirst({
      where: { accountId, type: "WHATSAPP", isEnabled: true },
    });
    if (channelConfig) {
      await sendWhatsApp(pipeline.transferPhone, notifyMsg, channelConfig.config as any, accountId);
    }
  }

  // Update lead status
  await prisma.lead.update({
    where: { id: conversation.leadId },
    data: { status: "QUALIFIED", updatedAt: new Date() },
  });

  // Log event
  await prisma.eventLog.create({
    data: {
      id: `evt_${Date.now()}`, accountId, event: "TRANSFER",
      data: { conversationId: conversation.id, leadId: conversation.leadId, transferTo: pipeline.transferPhone },
    },
  });

  return transferMsg;
}

/* ═══ FOLLOW-UP SCHEDULER ═══ */
function scheduleFollowUp(conversationId: string, accountId: string, pipeline: any, attempt: number) {
  if (attempt > (pipeline.followUpAttempts || 3)) return;

  const intervalHours = pipeline.followUpInterval || 24;
  const delayMs = intervalHours * 60 * 60 * 1000;

  setTimeout(async () => {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { lead: true },
      });
      if (!conversation || !conversation.isAIEnabled || !conversation.isActive) return;

      // Check if lead responded since last follow-up
      const lastMsg = await prisma.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
      });

      if (lastMsg && lastMsg.direction === "INBOUND") return; // Lead responded, no follow-up needed

      // Load AI config
      const aiConfig = await prisma.aIConfig.findUnique({ where: { accountId } });
      if (!aiConfig) return;

      // Generate follow-up
      const history = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        take: 20,
      });

      const messages = history.map(m => ({
        role: m.direction === "INBOUND" ? "user" : "assistant",
        content: m.content,
      }));

      messages.push({
        role: "system",
        content: `The lead hasn't responded in ${intervalHours} hours. Send a brief, natural follow-up message. This is follow-up attempt ${attempt} of ${pipeline.followUpAttempts}. Do NOT repeat your previous messages. Do NOT say "I'm here if you need anything". Be creative and add value. Keep it to 1-2 lines max.`,
      });

      const followUp = await generateAIResponse(aiConfig.systemPrompt, messages, aiConfig.temperature);
      if (!followUp) return;

      await saveMessage(conversationId, accountId, followUp, "OUTBOUND", true);
      await sendViaChannel(pipeline.primaryChannel, conversation.lead, followUp, accountId);

      // Schedule next follow-up
      scheduleFollowUp(conversationId, accountId, pipeline, attempt + 1);
    } catch (e: any) {
      console.error("[Engine] Follow-up error:", e.message);
    }
  }, delayMs);
}

/* ═══ HELPERS ═══ */
function extractPipeline(persona: any) {
  return {
    template: persona?.pipelineTemplate || "",
    goal: persona?.pipelineGoal || "",
    firstContact: persona?.pipelineFirstContact || "immediate",
    primaryChannel: persona?.pipelinePrimaryChannel || "WHATSAPP",
    secondaryChannel: persona?.pipelineSecondaryChannel || "",
    transferPhone: persona?.pipelineTransferPhone || "",
    transferMessage: persona?.pipelineTransferMessage || "",
    calendarEnabled: persona?.pipelineCalendarEnabled || false,
    calendarEmail: persona?.pipelineCalendarEmail || "",
    followUpEnabled: persona?.pipelineFollowUpEnabled ?? true,
    followUpAttempts: persona?.pipelineFollowUpAttempts ?? 3,
    followUpInterval: persona?.pipelineFollowUpInterval ?? 24,
    humanApproval: persona?.pipelineHumanApproval || false,
  };
}

function buildLeadContext(lead: any): string {
  const parts = [];
  if (lead.name) parts.push(`Name: ${lead.name}`);
  if (lead.email) parts.push(`Email: ${lead.email}`);
  if (lead.phone) parts.push(`Phone: ${lead.phone}`);
  if (lead.countryCode) parts.push(`Country: ${lead.countryCode}`);
  if (lead.metadata && typeof lead.metadata === "object") {
    const meta = lead.metadata as any;
    if (meta.source) parts.push(`Source: ${meta.source}`);
  }
  return parts.join("\n") || "No info available";
}

function getDelayMs(timing: string): number {
  switch (timing) {
    case "5min": return 5 * 60 * 1000;
    case "15min": return 15 * 60 * 1000;
    case "30min": return 30 * 60 * 1000;
    default: return 0;
  }
}

async function saveMessage(conversationId: string, accountId: string, content: string, direction: string, isAi: boolean) {
  return prisma.message.create({
    data: {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      content, direction: direction as any, isAiGenerated: isAi,
      contentType: "TEXT", conversationId, accountId,
    },
  });
}