// src/workers/index.ts
//
// Run with: npm run workers:dev (watch) or npm run workers (prod).
//
// All BullMQ workers for the lead engagement pipeline. Each worker is a single
// Worker instance tied to a queue. AIEngine is the only LLM entry point.

import { Worker } from "bullmq";
import { getQueueConnection, getRedis } from "@/lib/redis";
import prisma from "@/lib/db/prisma";
import { AIEngine } from "@/lib/ai-engine/engine";
import { getChannelProvider } from "@/lib/channels/factory";
import { WhatsAppProvider } from "@/lib/channels/whatsapp";
import { queues } from "@/lib/queues";
import { flushDebounceBuffer, debounceMessage } from "@/lib/debounce";
import { sendMessagesInParts } from "@/lib/ai-engine/send-parts";

const connection = getQueueConnection();
type Channel = "WHATSAPP" | "EMAIL" | "SMS";

console.log("Starting workers...");

// ═══════════════════════════════════════════════════════
// WORKER 1: LEAD PROCESSING (first contact for new leads)
// ═══════════════════════════════════════════════════════

const leadWorker = new Worker(
  "lead-processing",
  async (job) => {
    const { leadId, accountId, channel } = job.data as {
      leadId: string;
      accountId: string;
      channel: Channel;
    };
    console.log(`[lead-processing] New lead ${leadId} on ${channel}`);

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        campaign: {
          select: {
            name: true,
            transcription: true,
            description: true,
            metadata: true,
          },
        },
      },
    });

    if (!lead || lead.status !== "NEW") {
      console.log(`[lead-processing] Lead ${leadId} not NEW, skipping`);
      return;
    }

    const campaignMeta =
      (lead.campaign?.metadata as Record<string, unknown> | null) || {};
    const countries = Array.isArray(campaignMeta.countries)
      ? (campaignMeta.countries as string[])
      : [];
    const campaignCountry = countries[0];
    const campaignLanguage = typeof campaignMeta.aiLanguage === "string"
      ? (campaignMeta.aiLanguage as string)
      : undefined;

    const campaignInfo = lead.campaign
      ? `Campaign: ${lead.campaign.name}\n${lead.campaign.description || ""}\n${lead.campaign.transcription || ""}`
      : undefined;

    const message = await AIEngine.generateFirstContact({
      accountId,
      leadName: lead.name || undefined,
      leadSource: lead.source,
      campaignInfo,
      channel,
      leadMetadata: (lead.metadata as Record<string, unknown>) || undefined,
      campaignCountry,
      campaignLanguage,
    });

    const contactId =
      channel === "EMAIL" ? lead.email || "" : lead.phone || "";
    if (!contactId) {
      console.warn(`[lead-processing] Lead ${leadId} has no ${channel} contact`);
      return;
    }

    const conversation = await prisma.conversation.upsert({
      where: {
        accountId_leadId_channel: { accountId, leadId, channel },
      },
      create: {
        accountId,
        leadId,
        channel,
        channelIdentifier: contactId,
        isActive: true,
        isAIEnabled: true,
        lastMessageAt: new Date(),
      },
      update: {
        isActive: true,
        lastMessageAt: new Date(),
      },
    });

    const provider = await getChannelProvider(accountId, channel);
    if (!provider) {
      console.error(
        `[lead-processing] No ${channel} provider for account ${accountId}`
      );
      return;
    }

    // ── Split the reply into WhatsApp-style bubbles + presence/typing between each ──
    const sendOpts =
      channel === "EMAIL" ? ({ subject: "Olá!" } as Record<string, unknown>) : undefined;
    const { parts, messages, followUpHours } = await sendMessagesInParts({
      accountId,
      conversationId: conversation.id,
      to: contactId,
      fullText: message,
      provider,
      sendOpts,
      extraMetadata: { role: "first_contact" },
    });

    const firstMessageId = messages[0]?.id ?? null;
    const anySent = messages.some((m) => m.status === "SENT");

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: anySent ? "CONTACTED" : "NEW",
        lastContactAt: anySent ? new Date() : undefined,
      },
    });

    await prisma.eventLog.create({
      data: {
        accountId,
        event: "lead.first_contact",
        data: {
          leadId,
          channel,
          success: anySent,
          messageId: firstMessageId,
          parts: parts.length,
        },
      },
    });

    // Schedule follow-up: AI-requested delay wins, else default 24h guard
    const delayMs = (followUpHours ?? 24) * 60 * 60 * 1000;
    await queues.followUp.add(
      "follow-up",
      { leadId, accountId, channel, conversationId: conversation.id },
      { delay: delayMs }
    );

    console.log(
      `[lead-processing] First contact sent to ${leadId} via ${channel} (${parts.length} parts, followUp ${followUpHours ?? 24}h)`
    );
  },
  { connection, concurrency: 5 }
);

// ═══════════════════════════════════════════════════════
// WORKER 2: MESSAGE SENDING (queued outbound messages)
// ═══════════════════════════════════════════════════════

const messageSendingWorker = new Worker(
  "message-sending",
  async (job) => {
    const { accountId, messageId, channel, to } = job.data as {
      accountId: string;
      messageId: string;
      channel: Channel;
      to: string;
    };
    console.log(`[message-sending] Sending message ${messageId}`);

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!msg || msg.status === "SENT") return;

    const provider = await getChannelProvider(accountId, channel);
    if (!provider) {
      await prisma.message.update({
        where: { id: messageId },
        data: { status: "FAILED" },
      });
      return;
    }

    const result = await provider.send(to, msg.content);

    await prisma.message.update({
      where: { id: messageId },
      data: {
        status: result.success ? "SENT" : "FAILED",
        externalId: result.externalId || null,
      },
    });

    console.log(
      `[message-sending] ${result.success ? "Sent" : "Failed"} message ${messageId}`
    );
  },
  { connection, concurrency: 10 }
);

// ═══════════════════════════════════════════════════════
// WORKER 3: AI RESPONSE (debounced — reads Redis buffer)
//
// Two entry points:
//  - "debounced-respond" (from debounce.ts) → flush buffer, combine, respond
//  - "respond"           (legacy direct)    → use provided messageId only
// ═══════════════════════════════════════════════════════

const aiWorker = new Worker(
  "ai-response",
  async (job) => {
    const { accountId, leadId, conversationId, channel, messageId } =
      job.data as {
        accountId: string;
        leadId: string;
        conversationId: string;
        channel: Channel;
        messageId?: string;
      };

    console.log(
      `[ai-response] ${job.name} for lead ${leadId} (conv ${conversationId})`
    );

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: { include: { campaign: true } } },
    });
    if (!conversation) return;
    if (!conversation.isAIEnabled) {
      console.log(`[ai-response] AI disabled for ${conversationId}, skipping`);
      return;
    }

    // ── Resolve which inbound messages to collapse ──
    let pendingIds: string[] = [];
    if (job.name === "debounced-respond") {
      pendingIds = await flushDebounceBuffer(conversationId);
      if (pendingIds.length === 0) {
        console.log(
          `[ai-response] Debounce buffer empty for ${conversationId}, skipping`
        );
        return;
      }
    } else if (messageId) {
      pendingIds = [messageId];
    }

    // ── Load the combined inbound text ──
    let combinedInbound = "";
    if (pendingIds.length > 0) {
      const pendingMsgs = await prisma.message.findMany({
        where: { id: { in: pendingIds }, direction: "INBOUND" },
        orderBy: { createdAt: "asc" },
        select: { content: true },
      });
      combinedInbound = pendingMsgs.map((m) => m.content).join("\n");
    }

    // ── Build history (excluding the pending inbound messages) ──
    const historyRows = await prisma.message.findMany({
      where: {
        conversationId,
        ...(pendingIds.length > 0 ? { id: { notIn: pendingIds } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { direction: true, content: true },
    });

    const history = historyRows.map((m) => ({
      role: (m.direction === "INBOUND" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: m.content,
    }));

    const lead = conversation.lead;
    const campaignMeta =
      (lead.campaign?.metadata as Record<string, unknown> | null) || {};
    const countries = Array.isArray(campaignMeta.countries)
      ? (campaignMeta.countries as string[])
      : [];
    const campaignCountry = countries[0];
    const campaignLanguage = typeof campaignMeta.aiLanguage === "string"
      ? (campaignMeta.aiLanguage as string)
      : undefined;

    const campaignInfo = lead.campaign
      ? `Campaign: ${lead.campaign.name}\n${lead.campaign.transcription || ""}`
      : undefined;

    const aiResult = await AIEngine.generateResponse({
      accountId,
      leadName: lead.name || undefined,
      leadPhone: lead.phone || undefined,
      leadEmail: lead.email || undefined,
      leadSource: lead.source,
      campaignInfo,
      conversationHistory: history,
      currentMessage: combinedInbound || "(sem conteúdo)",
      channel: channel || "WHATSAPP",
      leadMetadata: (lead.metadata as Record<string, unknown>) || undefined,
      campaignCountry,
      campaignLanguage,
    });

    // ── Send via channel: split in parts + presence between each ──
    const contactId =
      channel === "EMAIL"
        ? lead.email || ""
        : conversation.channelIdentifier || lead.phone || "";

    const provider = await getChannelProvider(accountId, channel);
    let firstMessageId: string | null = null;
    let followUpHours: number | null = null;

    if (provider && contactId) {
      const sent = await sendMessagesInParts({
        accountId,
        conversationId,
        to: contactId,
        fullText: aiResult.message,
        provider,
        extraMetadata: {
          tags: aiResult.tags,
          sentiment: aiResult.sentiment,
        },
      });
      firstMessageId = sent.messages[0]?.id ?? null;
      followUpHours = sent.followUpHours;
    }

    // ── Update conversation sentiment / AI enabled flag ──
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        sentiment: aiResult.sentiment,
        ...(aiResult.isEscalation ? { isAIEnabled: false } : {}),
      },
    });

    // ── Schedule custom follow-up if the AI asked for one ──
    if (followUpHours && followUpHours > 0) {
      await queues.followUp.add(
        "follow-up",
        { leadId, accountId, channel, conversationId },
        { delay: followUpHours * 60 * 60 * 1000 }
      );
    }

    // ── Handle conversion/escalation side effects ──
    if (aiResult.isConversion) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: "CONVERTED" },
      });
      await prisma.eventLog.create({
        data: {
          accountId,
          event: "lead.converted",
          data: { leadId, conversationId, notify: aiResult.notificationMessage },
        },
      });
    }
    if (aiResult.isEscalation) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: "QUALIFIED" },
      });
      await prisma.eventLog.create({
        data: {
          accountId,
          event: "lead.escalated",
          data: { leadId, conversationId, notify: aiResult.notificationMessage },
        },
      });
    }

    if (aiResult.scheduled) {
      await prisma.eventLog.create({
        data: {
          accountId,
          event: "lead.meeting_scheduled",
          data: {
            leadId,
            conversationId,
            eventId: aiResult.scheduled.eventId,
            startISO: aiResult.scheduled.startISO,
            endISO: aiResult.scheduled.endISO,
            htmlLink: aiResult.scheduled.htmlLink,
          },
        },
      });
    }

    console.log(`[ai-response] Response sent for lead ${leadId}`);
  },
  { connection, concurrency: 3 }
);

// ═══════════════════════════════════════════════════════
// WORKER 4: TRANSCRIPTION (WhatsApp audio → text)
// After transcription we feed the result into the SAME debounce buffer
// so the AI worker picks it up together with any concurrent text messages.
// ═══════════════════════════════════════════════════════

const transcriptionWorker = new Worker(
  "transcription",
  async (job) => {
    const {
      accountId,
      leadId,
      conversationId,
      externalMessageId,
      instanceName,
    } = job.data as {
      accountId: string;
      leadId: string;
      conversationId: string;
      externalMessageId: string;
      instanceName: string;
    };

    console.log(`[transcription] Processing audio for lead ${leadId}`);

    const channelConfig = await prisma.channel.findFirst({
      where: { accountId, type: "WHATSAPP", isEnabled: true },
    });
    if (!channelConfig) {
      console.error("[transcription] No WhatsApp config found");
      return;
    }

    const cfg = channelConfig.config as Record<string, string>;
    const wa = new WhatsAppProvider({
      instanceName: cfg.instanceName || instanceName,
      evolutionApiUrl: cfg.evolutionApiUrl || process.env.EVOLUTION_API_URL || "",
      evolutionApiKey: cfg.evolutionApiKey || process.env.EVOLUTION_API_KEY || "",
    });

    const { buffer, mimetype } = await wa.downloadMedia(externalMessageId);
    const text = await AIEngine.transcribeAudio({ buffer, mimetype });

    if (!text) {
      console.warn(`[transcription] Empty transcription for ${leadId}`);
      return;
    }

    const message = await prisma.message.create({
      data: {
        accountId,
        conversationId,
        direction: "INBOUND",
        content: text,
        contentType: "AUDIO",
        externalId: externalMessageId,
        metadata: { originalType: "audio", transcription: text },
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // Feed into the debounce buffer so it's combined with any pending text
    await debounceMessage({
      conversationId,
      messageId: message.id,
      accountId,
      leadId,
      channel: "WHATSAPP",
    });

    console.log(`[transcription] Audio transcribed for lead ${leadId}`);
  },
  { connection, concurrency: 2 }
);

// ═══════════════════════════════════════════════════════
// WORKER 5: FOLLOW-UP (24h nudge if lead never replied)
// ═══════════════════════════════════════════════════════

const followUpWorker = new Worker(
  "follow-up",
  async (job) => {
    const { leadId, accountId, channel, conversationId } = job.data as {
      leadId: string;
      accountId: string;
      channel: Channel;
      conversationId: string;
    };
    console.log(`[follow-up] Checking lead ${leadId}`);

    const inboundCount = await prisma.message.count({
      where: { conversationId, direction: "INBOUND" },
    });
    if (inboundCount > 0) {
      console.log(`[follow-up] Lead ${leadId} already replied, skipping`);
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.status !== "CONTACTED") return;

    const followUpMsg = await AIEngine.generateFirstContact({
      accountId,
      leadName: lead.name || undefined,
      leadSource: lead.source,
      channel,
    });

    const contactId =
      channel === "EMAIL" ? lead.email || "" : lead.phone || "";
    if (!contactId) return;

    const provider = await getChannelProvider(accountId, channel);
    if (!provider) return;

    const dbMessage = await prisma.message.create({
      data: {
        accountId,
        conversationId,
        direction: "OUTBOUND",
        content: followUpMsg,
        contentType: "TEXT",
        isAIGenerated: true,
        status: "PENDING",
        metadata: { type: "follow-up" },
      },
    });

    const result = await provider.send(contactId, followUpMsg);
    await prisma.message.update({
      where: { id: dbMessage.id },
      data: {
        status: result.success ? "SENT" : "FAILED",
        externalId: result.externalId || null,
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { status: "UNRESPONSIVE" },
    });

    console.log(`[follow-up] Follow-up sent to lead ${leadId}`);
  },
  { connection, concurrency: 5 }
);

// ═══════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════

async function shutdown() {
  console.log("\nShutting down workers...");
  await Promise.all([
    leadWorker.close(),
    messageSendingWorker.close(),
    aiWorker.close(),
    transcriptionWorker.close(),
    followUpWorker.close(),
  ]);
  try {
    await getRedis().quit();
  } catch {
    // ignore
  }
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("All workers running. Waiting for jobs...");
