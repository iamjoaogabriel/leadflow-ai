// src/app/api/webhooks/whatsapp/route.ts
/**
 * Evolution API v2 Webhook Handler.
 * Receives incoming WhatsApp messages and routes to AI engine.
 *
 * Configure in Evolution API:
 * Webhook URL: https://yourapp.com/api/webhooks/whatsapp
 * Events: MESSAGES_UPSERT
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { processWhatsAppIncoming } from "@/lib/ai/engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event = body.event;

    // Only process new incoming messages
    if (event !== "messages.upsert") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const data = body.data;
    if (!data) return NextResponse.json({ ok: true });

    // Skip messages from us (outgoing)
    if (data.key?.fromMe) return NextResponse.json({ ok: true, skipped: "fromMe" });

    // Skip status messages, reactions, etc
    if (!data.message?.conversation && !data.message?.extendedTextMessage?.text) {
      return NextResponse.json({ ok: true, skipped: "non-text" });
    }

    // Extract message content
    const messageText = data.message?.conversation
      || data.message?.extendedTextMessage?.text
      || "";

    if (!messageText.trim()) return NextResponse.json({ ok: true, skipped: "empty" });

    // Extract phone number
    const remoteJid = data.key?.remoteJid || "";
    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");

    if (!phone || remoteJid.includes("@g.us")) {
      return NextResponse.json({ ok: true, skipped: "group-or-empty" });
    }

    // Find account by instance name
    const instanceName = body.instance || data.instance || "";
    const channel = await prisma.channel.findFirst({
      where: {
        type: "WHATSAPP",
        isEnabled: true,
        config: { path: ["instanceName"], equals: instanceName },
      },
    });

    if (!channel) {
      // Fallback: try to find any active WhatsApp channel
      const fallback = await prisma.channel.findFirst({ where: { type: "WHATSAPP", isEnabled: true } });
      if (!fallback) return NextResponse.json({ ok: true, skipped: "no-channel" });

      await processWhatsAppIncoming(fallback.accountId, phone, messageText);
      return NextResponse.json({ ok: true, processed: true });
    }

    await processWhatsAppIncoming(channel.accountId, phone, messageText);
    return NextResponse.json({ ok: true, processed: true });
  } catch (e: any) {
    console.error("[WhatsApp Webhook] Error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "WhatsApp webhook endpoint active" });
}